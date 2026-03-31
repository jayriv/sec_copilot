export type FilingKey = {
  ticker: string;
  year: string;
  formType: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceQuote?: string;
};

export type Highlight = {
  id: string;
  text: string;
  createdAt: number;
};

export type StoredSession = {
  filingKey: FilingKey;
  messages: ChatMessage[];
  highlights: Highlight[];
  documentText: string;
  selectedText: string;
  updatedAt: number;
};
