import { useEffect, useState } from "react";
import { getSkillTranslation, type SkillTranslation } from "../lib/skillTranslation";
import { getErrorMessage } from "../lib/error";
import { useTranslation } from "react-i18next";

export function useSkillTranslation(skillId: string, version: string) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const key = `${skillId}:${version}:${attempt}`;
  const [result, setResult] = useState<{ key: string; translation: SkillTranslation | null; error: string } | null>(null);

  useEffect(() => {
    let current = true;
    getSkillTranslation(skillId)
      .then(translation => { if (current) setResult({ key, translation, error: "" }); })
      .catch(error => { if (current) setResult({ key, translation: null, error: getErrorMessage(error, t("skillTranslation.loadFailed")) }); });
    return () => { current = false; };
  }, [skillId, key, t]);

  return {
    translation: result?.key === key ? result.translation : null,
    loading: result?.key !== key,
    error: result?.key === key ? result.error : "",
    reload: () => setAttempt(value => value + 1),
    accept: (translation: SkillTranslation) => setResult({ key, translation, error: "" }),
  };
}
