import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, Code, Segmented, Table } from "../components/ui.tsx";

const REQUEST = `POST <url>
Content-Type: application/json
x-api-key: <api_key>
Authorization: <barrier>

{"action":"check_card","uid":"04A1B2C3D4E5F6"}`;

const EXAMPLES: Record<string, string> = {
  "Node.js": `import express from "express";

const API_KEY = process.env.API_KEY;
const BARRIER = process.env.BARRIER;
const allowed = new Set(["04A1B2C3D4E5F6"]);

const app = express();
app.use(express.json());

app.post("/terminal", (req, res) => {
  if (req.get("x-api-key") !== API_KEY || req.get("authorization") !== BARRIER) {
    return res.status(401).json({ message: "Unauthorized terminal" });
  }
  const { action, uid } = req.body ?? {};
  if (action !== "check_card" || typeof uid !== "string") {
    return res.status(400).json({ message: "Bad Request" });
  }
  if (allowed.has(uid.toUpperCase())) {
    return res.json({ message: "Welcome" });          // green
  }
  return res.status(403).json({ message: "Access Denied" }); // red
});

// Serve it over HTTPS (e.g. behind a reverse proxy with a valid certificate).
app.listen(3000);`,
  Python: `import os
from flask import Flask, jsonify, request

API_KEY = os.environ["API_KEY"]
BARRIER = os.environ["BARRIER"]
ALLOWED = {"04A1B2C3D4E5F6"}

app = Flask(__name__)

@app.post("/terminal")
def check_card():
    if request.headers.get("x-api-key") != API_KEY or request.headers.get("Authorization") != BARRIER:
        return jsonify(message="Unauthorized terminal"), 401
    body = request.get_json(silent=True) or {}
    uid = str(body.get("uid", "")).upper()
    if body.get("action") != "check_card" or not uid:
        return jsonify(message="Bad Request"), 400
    if uid in ALLOWED:
        return jsonify(message="Welcome")                 # green
    return jsonify(message="Access Denied"), 403         # red`,
  PHP: `<?php
$apiKey  = getenv('API_KEY');
$barrier = getenv('BARRIER');
$allowed = ['04A1B2C3D4E5F6'];

header('Content-Type: application/json');
if (($_SERVER['HTTP_X_API_KEY'] ?? '') !== $apiKey ||
    ($_SERVER['HTTP_AUTHORIZATION'] ?? '') !== $barrier) {
    http_response_code(401);
    exit(json_encode(['message' => 'Unauthorized terminal']));
}
$body = json_decode(file_get_contents('php://input'), true) ?? [];
$uid  = strtoupper((string)($body['uid'] ?? ''));
if (($body['action'] ?? '') !== 'check_card' || $uid === '') {
    http_response_code(400);
    exit(json_encode(['message' => 'Bad Request']));
}
if (in_array($uid, $allowed, true)) {
    exit(json_encode(['message' => 'Welcome']));       // green
}
http_response_code(403);
echo json_encode(['message' => 'Access Denied']);      // red`,
};

export default function Integration() {
  const { t } = useTranslation();
  const [lang, setLang] = useState("Node.js");
  const host = "<terminal-ip>";

  const responses: [string, string][] = [
    ["200", t("integration.r200")],
    ["401 / 403", t("integration.r401")],
    [t("integration.rOtherCode"), t("integration.rOther")],
    [t("integration.rTimeoutCode"), t("integration.rTimeout")],
  ];

  const endpoints: [string, string, string][] = [
    ["GET /", t("integration.authNone"), t("integration.epInfo")],
    ["POST /connect", t("integration.authConnect"), t("integration.epConnect")],
    ["GET /diag", "Authorization: <barrier>", t("integration.epDiag")],
    ["POST /ota", "Authorization + X-Signature", t("integration.epOta")],
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("integration.flow")}>
        <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-sm">
          <li>{t("integration.flow1")}</li>
          <li>{t("integration.flow2")}</li>
          <li>{t("integration.flow3")}</li>
          <li>{t("integration.flow4")}</li>
        </ol>
      </Card>

      <Card title={t("integration.request")}>
        <p className="text-slate-500 dark:text-slate-400">{t("integration.requestHint")}</p>
        <Code>{REQUEST}</Code>
      </Card>

      <Card title={t("integration.responses")}>
        <Table>
            <thead>
              <tr>
                <th>{t("integration.status")}</th>
                <th>{t("integration.terminalShows")}</th>
              </tr>
            </thead>
            <tbody>
              {responses.map(([code, text]) => (
                <tr key={code}>
                  <td dir="ltr">
                    <strong>{code}</strong>
                  </td>
                  <td>{text}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        <p className="text-slate-500 dark:text-slate-400">{t("integration.messageRules")}</p>
        <Code>{`{"message":"Welcome"}`}</Code>
      </Card>

      <Card
        title={t("integration.examples")}
        actions={
          <Segmented size="sm" value={lang} onChange={setLang} options={Object.keys(EXAMPLES).map((k) => ({ value: k, label: k }))} />
        }
      >
        <Code>{EXAMPLES[lang]}</Code>
      </Card>

      <Card title={t("integration.testYourServer")}>
        <p className="text-slate-500 dark:text-slate-400">{t("integration.testYourServerHint")}</p>
        <Code>{`curl -X POST https://api.example.com/terminal \\
     -H "Content-Type: application/json" \\
     -H "x-api-key: <api_key>" \\
     -H "Authorization: <barrier>" \\
     -d '{"action":"check_card","uid":"04A1B2C3D4E5F6"}'`}</Code>
      </Card>

      <Card title={t("integration.localApi")}>
        <Table>
            <thead>
              <tr>
                <th>{t("integration.endpoint")}</th>
                <th>{t("integration.auth")}</th>
                <th>{t("integration.purpose")}</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map(([ep, auth, purpose]) => (
                <tr key={ep}>
                  <td dir="ltr" className="font-mono">
                    {ep}
                  </td>
                  <td dir="ltr" className="text-xs">
                    {auth}
                  </td>
                  <td>{purpose}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        <Code>{`curl http://${host}/
curl -H "Authorization: <barrier>" http://${host}/diag`}</Code>
      </Card>
    </div>
  );
}
