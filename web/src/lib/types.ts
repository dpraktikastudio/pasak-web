export type Category = "food" | "transport" | "bills" | "shopping" | "health" | "other";

export type ExpenseFields = {
  amount: number | null;
  currency: string | null;
  category: Category | null;
  item: string | null;
  merchant: string | null;
  date: string | null;
};

export type ExpenseRecord = {
  id: string;
  createdAt: string;
  transcript: string;
  prediction: ExpenseFields;
  correction: ExpenseFields | null;
  modelVersions: { stt: string; interpreter: string | null };
};
