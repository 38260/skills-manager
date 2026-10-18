import { useTranslation } from "react-i18next";
import { OperationResults, type OperationItem } from "./OperationResults";
import { retrySkillDeployments, type DeploymentResult, type ToolInfo, type WorkspaceImportResult } from "../lib/tauri";

export function WorkspaceDeploymentResults({ result, tools, onChanged, onClose }: {
  result: WorkspaceImportResult;
  tools: Pick<ToolInfo, "key" | "display_name">[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rows = (items: DeploymentResult[]): OperationItem[] => items.map(item => ({
    id: item.tool, name: tools.find(tool => tool.key === item.tool)?.display_name ?? item.tool,
    status: item.status, message: item.message,
  }));
  return <OperationResults report={{
    title: t("optimization.deploymentResultsTitle", { name: result.display_name || result.name }),
    items: rows(result.deployments ?? []),
    retry: async keys => {
      const retried = await retrySkillDeployments(result.id, keys);
      await onChanged();
      return rows(retried);
    },
  }} onClose={onClose} />;
}
