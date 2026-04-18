export type EnvironmentProfile = {
  projectRoot: string;
  pythonBin: string;
  status: "ready" | "missing" | "error";
};
