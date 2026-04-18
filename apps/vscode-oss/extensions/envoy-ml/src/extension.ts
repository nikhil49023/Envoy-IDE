import * as vscode from "vscode";

function createEnvoyTerminal(): vscode.Terminal {
  return vscode.window.createTerminal({
    name: "Envoy ML",
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });
}

function dashboardHtml(): string {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "  <style>",
    "    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #131722; color: #eceff8; }",
    "    .wrap { padding: 20px; display: grid; gap: 12px; }",
    "    .card { border: 1px solid #2e3a54; border-radius: 10px; background: #1a2131; padding: 12px; }",
    "    h1 { margin: 0; font-size: 20px; }",
    "    h2 { margin: 0 0 6px 0; font-size: 15px; }",
    "    p { margin: 0; color: #c5cee6; }",
    "    ul { margin: 0; padding-left: 18px; color: #c5cee6; }",
    "    code { color: #9edcff; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <div class=\"wrap\">",
    "    <h1>Envoy ML Workflow Dashboard</h1>",
    "    <div class=\"card\">",
    "      <h2>Quick Actions</h2>",
    "      <ul>",
    "        <li>Run tests with command: <code>Envoy: Run Python Tests</code></li>",
    "        <li>Run inspection with command: <code>Envoy: Run Inspection Workflow</code></li>",
    "      </ul>",
    "    </div>",
    "    <div class=\"card\">",
    "      <h2>Project Metadata</h2>",
    "      <p>Envoy uses project-local state under <code>.axiom</code> for runs, datasets, and artifacts.</p>",
    "    </div>",
    "  </div>",
    "</body>",
    "</html>"
  ].join("\n");
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("envoy.openWorkflowDashboard", () => {
      const panel = vscode.window.createWebviewPanel(
        "envoyWorkflowDashboard",
        "Envoy Workflow Dashboard",
        vscode.ViewColumn.Two,
        { enableScripts: false },
      );
      panel.webview.html = dashboardHtml();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("envoy.runPytest", () => {
      const terminal = createEnvoyTerminal();
      terminal.show(true);
      terminal.sendText("python3 -m pytest -q", true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("envoy.runInspectionWorkflow", () => {
      const terminal = createEnvoyTerminal();
      terminal.show(true);
      terminal.sendText("python3 -m axiom_engine.cli run --workflow inspection", true);
    }),
  );
}

export function deactivate(): void {
  // No-op: all resources are subscription-bound.
}
