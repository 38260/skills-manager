import { useEffect, useState } from "react";
import { getDiscoveredSkillTranslation, type SkillTranslation } from "../lib/skillTranslation";
import { getErrorMessage } from "../lib/error";
import { useTranslation } from "react-i18next";

/** 发现技能（未纳管）的译文状态：与 useSkillTranslation 同构，键从 skillId 换成发现路径。 */
export function useDiscoveredSkillTranslation(path: string, version: string) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const key = `${path}:${version}:${attempt}`;
  const [result, setResult] = useState<{ key: string; translation: SkillTranslation | null; error: string } | null>(null);

  useEffect(() => {
    let current = true;
    if (!path) return;
    getDiscoveredSkillTranslation(path)
      .then(translation => { if (current) setResult({ key, translation, error: "" }); })
      .catch(error => { if (current) setResult({ key, translation: null, error: getErrorMessage(error, t("skillTranslation.loadFailed")) }); });
    return () => { current = false; };
  }, [path, key, t]);

  return {
    translation: result?.key === key ? result.translation : null,
    loading: result?.key !== key,
    error: result?.key === key ? result.error : "",
    reload: () => setAttempt(value => value + 1),
    accept: (translation: SkillTranslation) => setResult({ key, translation, error: "" }),
  };
}
