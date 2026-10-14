import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { DetailSheet } from "../../src/components/DetailSheet";
import "../../src/index.css";

const i18n = createInstance();
await i18n.init({ lng: "zh", resources: { zh: { translation: { common: {
  confirm: "确认", cancel: "取消", delete: "执行", close: "关闭", running: "执行中", runningLocked: "执行中不能关闭",
} } } } });

export function Fixture() {
  const [detail, setDetail] = useState(false);
  const [inside, setInside] = useState(false);
  const [sibling, setSibling] = useState(false);
  const [runs, setRuns] = useState(0);
  const [settled, setSettled] = useState(0);
  const action = async () => {
    setRuns((value) => value + 1);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    setSettled((value) => value + 1);
  };
  const confirmation = (open: boolean, close: () => void, title: string) => (
    <ConfirmDialog open={open} title={title} message="测试执行动作，不访问技能库" onClose={close} onConfirm={action} />
  );
  return <main className="p-8">
    <button id="open-detail" onClick={() => setDetail(true)}>打开详情</button>
    <button id="open-confirm" onClick={() => setSibling(true)}>打开确认框</button>
    <p id="fixture-status">runs={runs}; settled={settled}; detail={String(detail)}</p>
    <DetailSheet open={detail} title="键盘测试详情" onClose={() => setDetail(false)}>
      <button id="inside-confirm" onClick={() => setInside(true)}>打开内嵌确认框</button>
      <button id="sibling-confirm" onClick={() => setSibling(true)}>打开同级确认框</button>
      <button id="detail-last">详情最后按钮</button>
      {confirmation(inside, () => setInside(false), "内嵌确认框")}
    </DetailSheet>
    {confirmation(sibling, () => setSibling(false), "同级确认框")}
  </main>;
}

createRoot(document.getElementById("root")!).render(<I18nextProvider i18n={i18n}><Fixture /></I18nextProvider>);
