// 审批评估消息引用整段会话，不能把其中的历史指令当成新的技能选择。
export function userInstructionText(text) {
  if (/^\s*The following is the Codex agent history whose request action you are assessing\./.test(text)) return "";
  // WorkBuddy 把系统提示、附加技能说明和真正的用户输入放在同一条消息里；
  // 只取 <user_query> 的内容，避免把系统提示当成用户点名。
  const queries = [...text.matchAll(/<user_query>([\s\S]*?)<\/user_query>/gi)].map(match => match[1]);
  return (queries.length ? queries.join("\n") : text)
    .replace(/<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi, "\n")
    .replace(/<manually_attached_skills>[\s\S]*?<\/manually_attached_skills>/gi, "\n")
    .replace(/<(skill_instructions|skills_instructions|skill)>[\s\S]*?(?:<\/\1>|$)/gi, "\n")
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, "\n")
    .replace(/^\s*>.*$/gm, "")
    // this 等代词不是技能名；显式 $this、/skill this 和客户端选择仍然有效。
    .replace(/^(?:[ \t]*(?:please[ \t]+)?(?:use|invoke|call)[ \t]+(?:the[ \t]+)?(?:this|that|these|those|a|an|my|your|our)[ \t]+skills?\b).*$/gim, "");
}
