import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, terminalMessage } from "../api.ts";
import type { OtaKey } from "../api.ts";
import { Button, Card, Code, Notice } from "../components/ui.tsx";

export default function Signing() {
  const { t } = useTranslation();
  const [key, setKey] = useState<OtaKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.otaKey().then(setKey, (e: unknown) => setError(terminalMessage(e)));
  }, []);

  const generate = async () => {
    const overwrite = Boolean(key?.pem);
    if (overwrite && !window.confirm(t("firmware.confirmOverwrite"))) return;
    try {
      setKey(await api.otaGenerate(overwrite));
      setError(null);
    } catch (e) {
      setError(terminalMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={t("firmware.keys")}
        actions={
          <Button variant={key?.pem ? "default" : "primary"} onClick={() => void generate()}>
            {key?.pem ? t("firmware.regenerate") : t("firmware.generate")}
          </Button>
        }
      >
        {error && <Notice tone="error">{error}</Notice>}
        {key && !key.pem && <Notice tone="info">{t("firmware.noKeys")}</Notice>}
        {key?.pem && key.c && (
          <>
            <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-sm">
              <li>{t("firmware.step1")}</li>
              <li>{t("firmware.step2")}</li>
              <li>{t("firmware.step3")}</li>
            </ol>
            <Code>{key.c}</Code>
            <details>
              <summary>{t("firmware.pem")}</summary>
              <Code>{key.pem}</Code>
            </details>
          </>
        )}
      </Card>
    </div>
  );
}
