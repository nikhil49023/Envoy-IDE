from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MODEL_SUFFIXES = {
    ".onnx",
    ".pt",
    ".pth",
    ".ckpt",
    ".safetensors",
    ".gguf",
    ".tflite",
    ".pb",
    ".h5",
    ".hdf5",
    ".keras",
    ".mlmodel",
    ".mlpackage",
    ".pkl",
    ".pickle",
    ".joblib",
    ".bin",
    ".npy",
    ".npz",
    ".xgb",
    ".ubj",
}

SPECIAL_MODEL_FILENAMES = {
    "saved_model.pb",
    "pytorch_model.bin",
    "model.safetensors",
    "model.onnx",
    "model.gguf",
}

IGNORED_SCAN_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    "node_modules",
    "dist",
    "build",
    "out",
    "__pycache__",
    ".venv",
    "venv",
    "site-packages",
}

ALLOWED_HIDDEN_DIRS = {
    ".axiom",
}

ONNX_DTYPE_BYTES = {
    1: 4,
    2: 1,
    3: 1,
    4: 2,
    5: 2,
    6: 4,
    7: 8,
    9: 1,
    10: 2,
    11: 8,
    12: 4,
    13: 8,
    14: 8,
    15: 16,
    16: 2,
    17: 1,
    18: 1,
    19: 4,
    20: 8,
}


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _dim_product(shape: list[Any]) -> int | None:
    values: list[int] = []
    for item in shape:
        if not isinstance(item, int):
            return None
        values.append(item)
    return math.prod(values)


def _scan_fingerprint(path: Path) -> dict[str, Any]:
    size_bytes = path.stat().st_size
    if size_bytes <= 128 * 1024 * 1024:
        digest = hashlib.sha256()
        with path.open("rb") as file_pointer:
            while True:
                chunk = file_pointer.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return {
            "sha256": digest.hexdigest(),
            "hash_mode": "full",
        }

    digest = hashlib.sha256()
    block_size = 4 * 1024 * 1024
    with path.open("rb") as file_pointer:
        head = file_pointer.read(block_size)
        digest.update(head)
        if size_bytes > block_size:
            file_pointer.seek(max(0, size_bytes - block_size))
            tail = file_pointer.read(block_size)
            digest.update(tail)

    return {
        "sha256": digest.hexdigest(),
        "hash_mode": "head_tail_4mb",
    }


def detect_model_format(path: Path) -> str:
    lower_name = path.name.lower()
    suffix = path.suffix.lower()

    if lower_name == "saved_model.pb":
        return "tensorflow_savedmodel"
    if suffix == ".onnx":
        return "onnx"
    if suffix == ".safetensors":
        return "safetensors"
    if suffix == ".gguf":
        return "gguf"
    if suffix == ".tflite":
        return "tflite"
    if suffix in {".h5", ".hdf5", ".keras"}:
        return "keras_hdf5"
    if suffix in {".pt", ".pth", ".ckpt", ".bin"}:
        return "pytorch"
    if suffix in {".pkl", ".pickle", ".joblib"}:
        return "pickle_like"
    if suffix in {".npz", ".npy"}:
        return "numpy_weights"
    if suffix in {".mlpackage", ".mlmodel"}:
        return "coreml"
    if suffix in {".xgb", ".ubj"}:
        return "xgboost"

    try:
        with path.open("rb") as file_pointer:
            prefix = file_pointer.read(16)
    except OSError:
        return "unknown"

    if prefix.startswith(b"GGUF"):
        return "gguf"
    if len(prefix) >= 8 and prefix[4:8] == b"TFL3":
        return "tflite"
    if prefix.startswith(b"\x89HDF\r\n\x1a\n"):
        return "keras_hdf5"
    if prefix.startswith(b"PK\x03\x04"):
        return "zip_container"
    if prefix[:1] == b"\x80":
        return "pickle_like"

    return "unknown"


def discover_model_files(project_root: Path, active_file: str | None, limit: int = 64) -> list[Path]:
    candidates: dict[str, Path] = {}

    if active_file:
        active_path = Path(active_file)
        if active_path.exists() and active_path.is_file():
            if detect_model_format(active_path) != "unknown" or active_path.suffix.lower() in MODEL_SUFFIXES:
                candidates[str(active_path)] = active_path

    for root, dirs, files in os.walk(project_root):
        dirs[:] = [
            directory
            for directory in dirs
            if directory not in IGNORED_SCAN_DIRS
            and (not directory.startswith(".") or directory in ALLOWED_HIDDEN_DIRS)
        ]

        current = Path(root)
        for filename in files:
            lower_name = filename.lower()
            candidate = current / filename
            if lower_name in SPECIAL_MODEL_FILENAMES or candidate.suffix.lower() in MODEL_SUFFIXES:
                candidates[str(candidate)] = candidate

    ordered = sorted(
        candidates.values(),
        key=lambda file_path: file_path.stat().st_mtime,
        reverse=True,
    )

    if limit > 0:
        ordered = ordered[:limit]

    return ordered


def _tensor_entry(name: str, shape: list[Any], dtype: str | None) -> dict[str, Any]:
    numel = _dim_product(shape)
    return {
        "name": name,
        "shape": shape,
        "dtype": dtype,
        "numel": numel,
    }


def _inspect_onnx(path: Path) -> dict[str, Any]:
    try:
        import onnx  # type: ignore
    except Exception as exc:  # pragma: no cover
        return {
            "warnings": [f"ONNX parsing unavailable: {exc}"],
            "metadata": {
                "reason": "Install onnx package for deep ONNX graph inspection.",
            },
        }

    model = onnx.load(str(path), load_external_data=False)

    inputs: list[dict[str, Any]] = []
    outputs: list[dict[str, Any]] = []

    def parse_value_info(value_info: Any) -> dict[str, Any]:
        dims: list[Any] = []
        tensor_type = value_info.type.tensor_type
        for dim in tensor_type.shape.dim:
            if dim.HasField("dim_value"):
                dims.append(int(dim.dim_value))
            elif dim.HasField("dim_param"):
                dims.append(str(dim.dim_param))
            else:
                dims.append("?")

        dtype_id = int(tensor_type.elem_type)
        dtype_name = onnx.TensorProto.DataType.Name(dtype_id)
        item_size = ONNX_DTYPE_BYTES.get(dtype_id)
        numel = _dim_product(dims)

        tensor_data = {
            "name": value_info.name,
            "shape": dims,
            "dtype": dtype_name,
            "numel": numel,
        }
        if numel is not None and item_size is not None:
            tensor_data["size_kb"] = round((numel * item_size) / 1024.0, 4)
        return tensor_data

    for tensor in model.graph.input:
        inputs.append(parse_value_info(tensor))

    for tensor in model.graph.output:
        outputs.append(parse_value_info(tensor))

    parameter_count = 0
    for initializer in model.graph.initializer:
        dims = [int(dim) for dim in initializer.dims]
        parameter_count += math.prod(dims) if dims else 0

    node_type_counts = Counter(node.op_type for node in model.graph.node)

    imports: dict[str, int] = {}
    for import_info in model.opset_import:
        domain = import_info.domain if import_info.domain else "ai.onnx"
        imports[domain] = int(import_info.version)

    return {
        "model_family": "onnx",
        "parameter_count": int(parameter_count),
        "node_count": int(sum(node_type_counts.values())),
        "node_type_counts": dict(node_type_counts.most_common()),
        "inputs": inputs,
        "outputs": outputs,
        "metadata": {
            "graph_name": model.graph.name,
            "ir_version": int(model.ir_version),
            "model_version": int(model.model_version),
            "producer_name": model.producer_name,
            "producer_version": model.producer_version,
            "opset_imports": imports,
        },
    }


def _inspect_safetensors(path: Path) -> dict[str, Any]:
    with path.open("rb") as file_pointer:
        raw_len = file_pointer.read(8)
        if len(raw_len) != 8:
            raise ValueError("Invalid safetensors header length.")

        header_len = int.from_bytes(raw_len, byteorder="little", signed=False)
        if header_len <= 0 or header_len > 32 * 1024 * 1024:
            raise ValueError("Unexpected safetensors header length.")

        header_bytes = file_pointer.read(header_len)
        header = json.loads(header_bytes.decode("utf-8"))

    metadata_block = header.get("__metadata__", {})
    tensor_entries = {
        name: value
        for name, value in header.items()
        if name != "__metadata__" and isinstance(value, dict)
    }

    tensor_preview: list[dict[str, Any]] = []
    dtype_counts: Counter[str] = Counter()
    parameter_count = 0

    for name, value in tensor_entries.items():
        dtype = str(value.get("dtype")) if value.get("dtype") is not None else None
        shape_raw = value.get("shape", [])
        shape = [int(item) for item in shape_raw if isinstance(item, int)]

        if dtype:
            dtype_counts[dtype] += 1

        if len(shape) == len(shape_raw):
            parameter_count += math.prod(shape) if shape else 0

        if len(tensor_preview) < 24:
            tensor_preview.append(_tensor_entry(name, shape if shape else list(shape_raw), dtype))

    return {
        "model_family": "weights",
        "parameter_count": int(parameter_count),
        "metadata": {
            "tensor_count": len(tensor_entries),
            "dtype_counts": dict(dtype_counts),
            "header_metadata": metadata_block,
        },
        "tensor_preview": tensor_preview,
    }


def _inspect_gguf(path: Path) -> dict[str, Any]:
    with path.open("rb") as file_pointer:
        header = file_pointer.read(24)

    if len(header) < 24 or not header.startswith(b"GGUF"):
        raise ValueError("Invalid GGUF header.")

    version = int(struct.unpack("<I", header[4:8])[0])
    tensor_count = int(struct.unpack("<Q", header[8:16])[0])
    metadata_count = int(struct.unpack("<Q", header[16:24])[0])

    return {
        "model_family": "gguf",
        "metadata": {
            "gguf_version": version,
            "tensor_count": tensor_count,
            "metadata_entry_count": metadata_count,
        },
    }


def _inspect_tflite(path: Path) -> dict[str, Any]:
    with path.open("rb") as file_pointer:
        prefix = file_pointer.read(8)

    if len(prefix) < 8 or prefix[4:8] != b"TFL3":
        raise ValueError("Invalid TFLite flatbuffer identifier.")

    return {
        "model_family": "tensorflow_lite",
        "metadata": {
            "flatbuffer_identifier": "TFL3",
        },
    }


def _inspect_keras_hdf5(path: Path) -> dict[str, Any]:
    with path.open("rb") as file_pointer:
        signature = file_pointer.read(8)

    is_hdf5 = signature == b"\x89HDF\r\n\x1a\n"
    details: dict[str, Any] = {
        "hdf5_signature": is_hdf5,
    }

    try:
        import h5py  # type: ignore

        with h5py.File(path, "r") as h5_file:  # type: ignore
            root_keys = list(h5_file.keys())
            details["root_groups"] = root_keys[:32]
            details["root_group_count"] = len(root_keys)
            details["keras_version"] = h5_file.attrs.get("keras_version")
            details["backend"] = h5_file.attrs.get("backend")
    except Exception as exc:  # pragma: no cover
        details["note"] = f"h5py unavailable or failed: {exc}"

    return {
        "model_family": "keras",
        "metadata": details,
    }


def _inspect_zip_container(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path, "r") as archive:
        names = archive.namelist()
        sample_names = names[:36]

        top_level = sorted({item.split("/")[0] for item in names if item})

        model_family = "zip_container"
        metadata: dict[str, Any] = {
            "entry_count": len(names),
            "top_level_entries": top_level,
            "sample_entries": sample_names,
        }

        if any(item.endswith("data.pkl") for item in names):
            model_family = "pytorch_zip"
            metadata["framework_hint"] = "PyTorch zip archive"

        if any(item.endswith("saved_model.pb") for item in names):
            model_family = "tensorflow_savedmodel"
            metadata["framework_hint"] = "TensorFlow SavedModel archive"

    return {
        "model_family": model_family,
        "metadata": metadata,
    }


def _inspect_pickle_like(path: Path) -> dict[str, Any]:
    return {
        "model_family": "pickle_like",
        "warnings": [
            "Pickle/joblib payload was not loaded for security reasons. Metadata is file-level only."
        ],
    }


def _inspect_numpy_weights(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".npz":
        with zipfile.ZipFile(path, "r") as archive:
            names = archive.namelist()
        return {
            "model_family": "numpy_weights",
            "metadata": {
                "array_entries": len(names),
                "sample_entries": names[:40],
            },
        }

    return {
        "model_family": "numpy_weights",
        "metadata": {
            "array_format": "npy",
        },
    }


def _inspect_coreml(path: Path) -> dict[str, Any]:
    return {
        "model_family": "coreml",
        "metadata": {
            "packaging": "directory" if path.suffix.lower() == ".mlpackage" else "file",
        },
    }


def _inspect_xgboost(path: Path) -> dict[str, Any]:
    return {
        "model_family": "xgboost",
        "metadata": {
            "format_hint": path.suffix.lower().lstrip("."),
        },
    }


def inspect_model_file(path: Path) -> dict[str, Any]:
    detected_format = detect_model_format(path)
    fingerprint = _scan_fingerprint(path)

    base: dict[str, Any] = {
        "path": str(path),
        "name": path.name,
        "format": detected_format,
        "file_size_bytes": path.stat().st_size,
        "modified_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
        "inspected_at": _now_iso(),
        **fingerprint,
        "warnings": [],
        "metadata": {},
        "inputs": [],
        "outputs": [],
        "node_type_counts": {},
        "node_count": None,
        "parameter_count": None,
    }

    try:
        if detected_format == "onnx":
            details = _inspect_onnx(path)
        elif detected_format == "safetensors":
            details = _inspect_safetensors(path)
        elif detected_format == "gguf":
            details = _inspect_gguf(path)
        elif detected_format == "tflite":
            details = _inspect_tflite(path)
        elif detected_format == "keras_hdf5":
            details = _inspect_keras_hdf5(path)
        elif detected_format in {"pytorch", "zip_container"}:
            details = _inspect_zip_container(path)
        elif detected_format == "pickle_like":
            details = _inspect_pickle_like(path)
        elif detected_format == "numpy_weights":
            details = _inspect_numpy_weights(path)
        elif detected_format == "coreml":
            details = _inspect_coreml(path)
        elif detected_format == "xgboost":
            details = _inspect_xgboost(path)
        else:
            details = {
                "model_family": "unknown",
                "warnings": ["Format is not recognized yet. File-level metadata only."],
            }
    except Exception as exc:  # pragma: no cover
        details = {
            "model_family": detected_format,
            "warnings": [f"Inspection failed: {exc}"],
            "metadata": {},
        }

    base.update(details)
    if "warnings" not in base:
        base["warnings"] = []

    return base


def inspect_models(project_root: Path, active_file: str | None) -> dict[str, Any]:
    files = discover_model_files(project_root, active_file)
    models = [inspect_model_file(path) for path in files]

    by_format = Counter(model["format"] for model in models)
    with_parameters = [model for model in models if isinstance(model.get("parameter_count"), int)]

    return {
        "project_root": str(project_root),
        "active_file": active_file,
        "model_count": len(models),
        "formats": dict(by_format),
        "inspectable_parameter_models": len(with_parameters),
        "models": models,
        "generated_at": _now_iso(),
    }


def render_markdown_report(payload: dict[str, Any], run_id: str) -> str:
    lines: list[str] = []
    lines.append("# Model Inspection")
    lines.append("")
    lines.append(f"Run ID: {run_id}")
    lines.append(f"Generated: {payload.get('generated_at')}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Model files discovered: {payload.get('model_count', 0)}")
    format_entries = payload.get("formats", {})
    if format_entries:
        lines.append("- Format distribution:")
        for model_format, count in sorted(format_entries.items()):
            lines.append(f"  - {model_format}: {count}")
    else:
        lines.append("- Format distribution: none")

    lines.append("")
    lines.append("| Model | Format | Size (MiB) | Params | Inputs | Outputs |")
    lines.append("| --- | --- | ---: | ---: | ---: | ---: |")

    for model in payload.get("models", []):
        size_mib = float(model.get("file_size_bytes", 0)) / (1024.0 * 1024.0)
        params = model.get("parameter_count")
        inputs = len(model.get("inputs") or [])
        outputs = len(model.get("outputs") or [])
        lines.append(
            "| "
            + f"{model.get('name', 'unknown')} | "
            + f"{model.get('format', 'unknown')} | "
            + f"{size_mib:.2f} | "
            + f"{params if isinstance(params, int) else '-'} | "
            + f"{inputs} | "
            + f"{outputs} |"
        )

    lines.append("")
    lines.append("## Details")

    for model in payload.get("models", []):
        lines.append("")
        lines.append(f"### {model.get('name', 'unknown')}")
        lines.append("")
        lines.append(f"- Path: {model.get('path')}")
        lines.append(f"- Format: {model.get('format')}")
        lines.append(f"- Family: {model.get('model_family', 'unknown')}")
        lines.append(f"- Hash: {model.get('sha256')} ({model.get('hash_mode')})")

        parameter_count = model.get("parameter_count")
        if isinstance(parameter_count, int):
            lines.append(f"- Parameters: {parameter_count}")

        metadata = model.get("metadata") or {}
        if metadata:
            lines.append("- Metadata:")
            for key, value in metadata.items():
                lines.append(f"  - {key}: {value}")

        inputs = model.get("inputs") or []
        if inputs:
            lines.append("- Inputs:")
            for tensor in inputs[:12]:
                lines.append(
                    f"  - {tensor.get('name')}: shape={tensor.get('shape')} dtype={tensor.get('dtype')}"
                )

        outputs = model.get("outputs") or []
        if outputs:
            lines.append("- Outputs:")
            for tensor in outputs[:12]:
                lines.append(
                    f"  - {tensor.get('name')}: shape={tensor.get('shape')} dtype={tensor.get('dtype')}"
                )

        node_type_counts = model.get("node_type_counts") or {}
        if node_type_counts:
            lines.append("- Node types:")
            for op_type, count in list(node_type_counts.items())[:16]:
                lines.append(f"  - {op_type}: {count}")

        warnings = model.get("warnings") or []
        if warnings:
            lines.append("- Warnings:")
            for warning in warnings:
                lines.append(f"  - {warning}")

    return "\n".join(lines) + "\n"
