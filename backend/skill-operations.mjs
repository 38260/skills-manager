// 扩展命令独立登记，避免把用户现有服务接入改动捆进本轮提交。
export function skillOperationCommands(library) {
  return {
    retry_skill_deployments: { call: args => library.retryDeployments(args.skillId, args.tools), mutating: true },
  };
}
