export type ApprovalDocument = {
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  expiresOn: Date | null;
};

export function hasValidApprovalDocument(documents: readonly ApprovalDocument[], now: Date): boolean {
  const today = now.toISOString().slice(0, 10);
  return documents.some((document) => {
    if (document.status !== "APPROVED") {
      return false;
    }
    if (!document.expiresOn) {
      return true;
    }
    return document.expiresOn.toISOString().slice(0, 10) >= today;
  });
}
