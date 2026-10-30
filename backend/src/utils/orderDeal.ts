export const ORDER_STATUS_AWAITING_DEPOSIT = "AWAITING_DEPOSIT";

export const ORDER_DEPOSIT_STATUS = {
  NOT_REQUIRED: "NOT_REQUIRED",
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  PAID: "PAID",
  REJECTED: "REJECTED",
} as const;

export const DEFAULT_ORDER_DEPOSIT_PERCENT = 10;
export const DEFAULT_ORDER_DEPOSIT_PAYER_ROLE = "CARRIER";

export const calculateDepositAmount = (price: number, percent = DEFAULT_ORDER_DEPOSIT_PERCENT) => {
  const normalizedPrice = Number.isFinite(price) ? price : 0;
  const normalizedPercent = Number.isFinite(percent) ? percent : DEFAULT_ORDER_DEPOSIT_PERCENT;
  return Math.max(0, Math.round((normalizedPrice * normalizedPercent) / 100));
};

export const isContactsUnlocked = (order: {
  status?: string | null;
  depositStatus?: string | null;
  contactsUnlockedAt?: Date | string | null;
}) =>
  Boolean(order.contactsUnlockedAt) ||
  (order.status !== ORDER_STATUS_AWAITING_DEPOSIT && order.depositStatus === ORDER_DEPOSIT_STATUS.PAID);
