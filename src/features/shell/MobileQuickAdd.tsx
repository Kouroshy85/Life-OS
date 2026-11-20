import { CalendarPlus, Coins, Plus, Target, Wallet } from "lucide-react";
import { useRef, useState } from "react";
import { FinanceEditor, transactionRequest, type EditorRequest } from "../finance/FinanceEditor";
import { PlanWizard } from "../planner/PlanWizard";
import { t } from "../../i18n";
import { useFinance } from "../../state/finance";
import { openComposer } from "../../state/store";
import { Button, Dialog } from "../../ui/primitives";

export function MobileQuickAdd() {
  const [open, setOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [finance, setFinance] = useState<{ type: "expense" | "income"; request: EditorRequest } | null>(null);
  const data = useFinance((s) => s.data);
  const trigger = useRef<HTMLButtonElement>(null);
  const addFinance = (type: "expense" | "income") => {
    setOpen(false);
    setFinance({ type, request: transactionRequest(data, type) });
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn--primary quick-add-trigger"
        aria-label={t.quickAdd}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Plus size={23} aria-hidden="true" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t.quickAdd}>
        <div className="quick-add-actions">
          <Button variant="ghost" icon={<Target size={19} />} onClick={() => { setOpen(false); openComposer(true); }}>{t.addGoal}</Button>
          <Button variant="ghost" icon={<Wallet size={19} />} onClick={() => addFinance("expense")}>{t.addTransaction}</Button>
          <Button variant="ghost" icon={<CalendarPlus size={19} />} onClick={() => { setOpen(false); setPlanOpen(true); }}>{t.addPlan}</Button>
          <Button variant="ghost" icon={<Coins size={19} />} onClick={() => addFinance("income")}>{t.addIncome}</Button>
        </div>
      </Dialog>
      {planOpen && <PlanWizard open type="default" onClose={() => setPlanOpen(false)} />}
      {finance && (
        <FinanceEditor
          key={finance.request.entity}
          request={finance.request}
          data={data}
          onClose={() => { setFinance(null); trigger.current?.focus(); }}
          onSaved={finance.request.entity === "account" ? (saved) => {
            setFinance({ type: finance.type, request: transactionRequest(saved, finance.type) });
          } : undefined}
        />
      )}
    </>
  );
}
