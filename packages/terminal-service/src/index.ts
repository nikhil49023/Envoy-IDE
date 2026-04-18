export type TerminalLine = {
  stream: "stdout" | "stderr";
  text: string;
  ts: string;
};
