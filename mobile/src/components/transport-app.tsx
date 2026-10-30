import React, { startTransition, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppSpacing, Palette } from "@/constants/app-theme";
import { mobileApi } from "@/lib/mobile-api";
import type {
  BootstrapPayload,
  CarrierOrderStatus,
  CarrierProfile,
  CustomerOrderRequest,
  MobileRole,
  Order,
  OrderOffer,
  QuotePayload,
  Vehicle,
} from "@/lib/mobile-types";
import { useSession } from "@/providers/session-provider";

type NoticeTone = "success" | "danger" | "info";

type NoticeState = {
  tone: NoticeTone;
  message: string;
};

type CustomerTab = "brief" | "create" | "orders" | "profile";
type CarrierTab = "brief" | "open" | "active" | "fleet" | "profile";

type CustomerOrderForm = {
  regionId: string;
  categoryId: string;
  vehicleType: string;
  routeFrom: string;
  routeTo: string;
  date: string;
  adultsCount: string;
  childrenCount: string;
  passengersCount: string;
  cargoDescription: string;
  weight: string;
  volume: string;
  comment: string;
};

type CarrierRegistrationForm = {
  fullName: string;
  phone: string;
  regionId: string;
  vehicleType: string;
  brand: string;
  capacity: string;
  plateNumber: string;
  description: string;
  features: string;
};

type VehicleForm = {
  vehicleType: string;
  brand: string;
  capacity: string;
  plateNumber: string;
  description: string;
  features: string;
};

type OfferDraft = {
  proposedPrice: string;
  pickupEtaText: string;
  note: string;
};

type DepositDraft = {
  paymentReference: string;
  note: string;
};

type ReturnDraft = {
  date: string;
  routeTo: string;
  comment: string;
};

type DispatchDraft = {
  vehicleId: string;
  driverName: string;
  driverPhone: string;
};

type PendingChallenge = {
  challengeId: string;
  expiresAt: string;
  deliveryChannel: string;
  debugCode?: string;
  role: MobileRole;
  name: string;
  phone: string;
};

const CARGO_TYPES = new Set(["GAZELLE", "TRUCK", "TRAILER", "SPECIAL"]);

const formatMoney = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "по запросу";
  }

  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "дата уточняется";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDistance = (distance?: number | null) => {
  if (typeof distance !== "number" || Number.isNaN(distance)) {
    return "маршрут рассчитывается";
  }

  return `${distance.toFixed(distance >= 100 ? 0 : 1)} км`;
};

const formatStatus = (value: string) => {
  const dictionary: Record<string, string> = {
    AWAITING_DEPOSIT: "Ждем депозит",
    NEW: "Новая",
    ACCEPTED: "Подтверждена",
    IN_PROGRESS: "В работе",
    COMPLETED: "Завершена",
    CANCELLED: "Отменена",
    ACTIVE: "Активен",
    REJECTED: "Отклонен",
    COUNTERED: "Торг",
    APPROVED: "Одобрен",
    PENDING_APPROVAL: "На модерации",
    PENDING_PAYMENT: "Ожидаем оплату",
    PENDING_VERIFICATION: "Платежка на проверке",
    PAID: "Оплачено",
  };
  return dictionary[value] ?? value;
};

const formatContactsLine = (name?: string | null, phone?: string | null) => {
  const parts = [name, phone].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Контакты еще закрыты";
};

const parseNumber = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getDefaultDateValue = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const createCustomerForm = (bootstrap: BootstrapPayload): CustomerOrderForm => ({
  regionId: String(bootstrap.regions[0]?.id ?? ""),
  categoryId: String(bootstrap.categories[0]?.id ?? ""),
  vehicleType: bootstrap.vehicleTypes[0]?.value ?? "MINIVAN",
  routeFrom: "",
  routeTo: "",
  date: getDefaultDateValue(),
  adultsCount: "1",
  childrenCount: "0",
  passengersCount: "1",
  cargoDescription: "",
  weight: "",
  volume: "",
  comment: "",
});

const createCarrierRegistrationForm = (
  bootstrap: BootstrapPayload,
  seed?: { fullName?: string | null; phone?: string | null; vehicleType?: string | null }
): CarrierRegistrationForm => ({
  fullName: seed?.fullName ?? "",
  phone: seed?.phone ?? "",
  regionId: String(bootstrap.regions[0]?.id ?? ""),
  vehicleType: seed?.vehicleType ?? bootstrap.vehicleTypes[0]?.value ?? "MINIVAN",
  brand: "",
  capacity: "",
  plateNumber: "",
  description: "",
  features: "",
});

const createVehicleForm = (bootstrap: BootstrapPayload): VehicleForm => ({
  vehicleType: bootstrap.vehicleTypes[0]?.value ?? "MINIVAN",
  brand: "",
  capacity: "",
  plateNumber: "",
  description: "",
  features: "",
});

const createReturnDraft = (order: Order): ReturnDraft => ({
  date: getDefaultDateValue(),
  routeTo: order.routeFrom,
  comment: "",
});

const createDispatchDraft = (order: Order): DispatchDraft => ({
  vehicleId: order.vehicle?.id ? String(order.vehicle.id) : "",
  driverName: order.dispatch?.driverName ?? "",
  driverPhone: order.dispatch?.driverPhone ?? "",
});

const getCustomerQuoteKey = (form: CustomerOrderForm) =>
  JSON.stringify({
    regionId: form.regionId,
    categoryId: form.categoryId,
    vehicleType: form.vehicleType,
    routeFrom: form.routeFrom.trim(),
    routeTo: form.routeTo.trim(),
    date: form.date,
    adultsCount: form.adultsCount,
    childrenCount: form.childrenCount,
    passengersCount: form.passengersCount,
    cargoDescription: form.cargoDescription.trim(),
    weight: form.weight,
    volume: form.volume,
  });

const hasPhoneDigits = (value: string) => value.replace(/\D/g, "").length >= 7;

const isValidDateValue = (value: string) => !Number.isNaN(Date.parse(value));

const isPositiveNumber = (value: string) => {
  const parsed = parseNumber(value);
  return typeof parsed === "number" && parsed > 0;
};

const validateGuestProfile = (name: string, phone: string) => {
  if (name.trim().length < 2) {
    return "Укажите имя или название компании, чтобы мы могли подписать вход.";
  }

  if (!hasPhoneDigits(phone)) {
    return "Укажите телефон в понятном формате, чтобы отправить код подтверждения.";
  }

  return null;
};

const validateVerificationCode = (code: string) => {
  if (code.trim().length < 4) {
    return "Введите код подтверждения из Telegram или SMS.";
  }

  return null;
};

const validateCustomerOrderForm = (form: CustomerOrderForm, isCargoFlow: boolean) => {
  if (!form.regionId || !form.categoryId || !form.vehicleType) {
    return "Выберите регион, сценарий заявки и тип транспорта.";
  }

  if (form.routeFrom.trim().length < 3 || form.routeTo.trim().length < 3) {
    return "Заполните адрес отправления и адрес назначения.";
  }

  if (!isValidDateValue(form.date)) {
    return "Проверьте дату и время подачи.";
  }

  if (isCargoFlow) {
    if (form.cargoDescription.trim().length < 3) {
      return "Коротко опишите груз, чтобы перевозчики понимали задачу.";
    }

    if (form.weight.trim() && !isPositiveNumber(form.weight)) {
      return "Вес груза должен быть больше нуля.";
    }

    if (form.volume.trim() && !isPositiveNumber(form.volume)) {
      return "Объем груза должен быть больше нуля.";
    }

    return null;
  }

  const passengersCount = parseNumber(form.passengersCount);
  if (!passengersCount || passengersCount <= 0) {
    return "Укажите количество пассажиров.";
  }

  const adultsCount = parseNumber(form.adultsCount) ?? 0;
  const childrenCount = parseNumber(form.childrenCount) ?? 0;
  if (adultsCount < 0 || childrenCount < 0) {
    return "Количество взрослых и детей не может быть отрицательным.";
  }

  return null;
};

const validateReturnDraft = (draft: ReturnDraft) => {
  if (!isValidDateValue(draft.date)) {
    return "Проверьте дату и время обратного рейса.";
  }

  if (draft.routeTo.trim().length < 3) {
    return "Укажите адрес для обратного рейса.";
  }

  return null;
};

const validateCarrierBaseProfile = (form: CarrierRegistrationForm) => {
  if (form.fullName.trim().length < 2) {
    return "Укажите ФИО или название перевозчика.";
  }

  if (!hasPhoneDigits(form.phone)) {
    return "Укажите рабочий телефон перевозчика.";
  }

  if (!form.regionId) {
    return "Выберите основной регион работы.";
  }

  return null;
};

const validateCarrierRegistrationForm = (form: CarrierRegistrationForm) => {
  const profileError = validateCarrierBaseProfile(form);
  if (profileError) {
    return profileError;
  }

  if (!form.vehicleType) {
    return "Выберите базовый тип транспорта.";
  }

  if (form.brand.trim().length < 2) {
    return "Укажите марку или модель транспорта.";
  }

  if (!isPositiveNumber(form.capacity)) {
    return "Вместимость или грузоподъемность должна быть больше нуля.";
  }

  if (form.plateNumber.trim().length < 3) {
    return "Укажите госномер.";
  }

  if (form.description.trim().length < 3) {
    return "Добавьте короткое описание парка или услуги.";
  }

  return null;
};

const validateVehicleForm = (form: VehicleForm) => {
  if (!form.vehicleType) {
    return "Выберите тип транспорта.";
  }

  if (form.brand.trim().length < 2) {
    return "Укажите марку или модель машины.";
  }

  if (!isPositiveNumber(form.capacity)) {
    return "Вместимость или грузоподъемность должна быть больше нуля.";
  }

  if (form.plateNumber.trim().length < 3) {
    return "Укажите госномер машины.";
  }

  if (form.description.trim().length < 3) {
    return "Добавьте короткое описание машины.";
  }

  return null;
};

const validateOfferDraft = (draft?: OfferDraft) => {
  if (!draft || !isPositiveNumber(draft.proposedPrice)) {
    return "Укажите цену оффера больше нуля.";
  }

  return null;
};

const validateDepositDraft = (draft?: DepositDraft) => {
  if (!draft?.paymentReference || draft.paymentReference.trim().length < 3) {
    return "Укажите номер платежа или ссылку на перевод.";
  }

  return null;
};

const validateDispatchDraft = (draft: DispatchDraft, matchingVehicles: Vehicle[]) => {
  if (matchingVehicles.length > 0 && !draft.vehicleId) {
    return "Выберите машину для рейса.";
  }

  if (draft.driverName.trim().length < 2) {
    return "Укажите имя водителя.";
  }

  if (!hasPhoneDigits(draft.driverPhone)) {
    return "Укажите телефон водителя в рабочем формате.";
  }

  return null;
};

export function TransportApp() {
  const { isReady, token, user, isLocked, biometricEnabled, unlockApp } = useSession();
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadBootstrap = async () => {
      try {
        const payload = await mobileApi.bootstrap();
        if (isMounted) {
          setBootstrap(payload);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить справочники");
        }
      }
    };

    void loadBootstrap();
    return () => {
      isMounted = false;
    };
  }, []);

  if (!isReady || !bootstrap) {
    return <LoadingScreen label={error ? "Проверяю контур запуска" : "Собираю транспортный контур"} error={error} />;
  }

  if (!token || !user) {
    return <GuestWorkspace bootstrap={bootstrap} />;
  }

  if (isLocked) {
    return <LockedWorkspace biometricEnabled={biometricEnabled} onUnlock={() => void unlockApp()} />;
  }

  if (user.role === "CUSTOMER") {
    return <CustomerWorkspace bootstrap={bootstrap} token={token} />;
  }

  return <CarrierWorkspace bootstrap={bootstrap} token={token} />;
}

function LoadingScreen({ label, error }: { label: string; error?: string | null }) {
  return (
    <ScreenScaffold>
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>ARTUR PRO</Text>
        <Text style={styles.heroTitle}>Мобильный диспетчерский контур</Text>
        <Text style={styles.heroText}>{label}</Text>
        <ActivityIndicator color={Palette.amber} size="large" />
        {error ? <Banner tone="danger" message={error} /> : null}
      </View>
    </ScreenScaffold>
  );
}

function ScreenScaffold({
  children,
  onRefresh,
  refreshing = false,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.orbOne} />
        <View style={styles.orbTwo} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardWrap}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.amber} />
              ) : undefined
            }
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

function HeroCard({
  eyebrow,
  title,
  subtitle,
  rightSlot,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <View style={styles.heroCard}>
      <View style={styles.heroTopRow}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroText}>{subtitle}</Text>
        </View>
        {rightSlot ? <View style={styles.heroRightSlot}>{rightSlot}</View> : null}
      </View>
    </View>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.sectionCard}>{children}</View>;
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.sectionTitleWrap}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

function Banner({ tone, message }: NoticeState) {
  return (
    <View
      style={[
        styles.banner,
        tone === "danger" ? styles.bannerDanger : tone === "success" ? styles.bannerSuccess : styles.bannerInfo,
      ]}
    >
      <Text style={styles.bannerText}>{message}</Text>
    </View>
  );
}

function MetricCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function AppButton({
  label,
  onPress,
  variant = "primary",
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" ? styles.buttonPrimary : variant === "secondary" ? styles.buttonSecondary : styles.buttonGhost,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.buttonPressed : null,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === "ghost" ? styles.buttonGhostText : styles.buttonSolidText,
          disabled ? styles.buttonTextDisabled : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Field({ label, multiline = false, ...props }: TextInputProps & { label: string; multiline?: boolean }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={Palette.slate}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        multiline={multiline}
        {...props}
      />
    </View>
  );
}

function ChoiceChips({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            onPress={() => onChange(option.value)}
            style={[styles.chip, active ? styles.chipActive : null]}
          >
            <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <View style={styles.statusBadge}>
      <Text style={styles.statusBadgeText}>{label}</Text>
    </View>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateText}>{text}</Text>
    </View>
  );
}

function DealStatusCard({
  order,
  role,
}: {
  order: Order;
  role: "CUSTOMER" | "CARRIER";
}) {
  if (!order.deal) {
    return null;
  }

  const { deal } = order;
  const primaryContact =
    role === "CUSTOMER"
      ? formatContactsLine(deal.sharedContacts.carrierName, deal.sharedContacts.carrierPhone)
      : formatContactsLine(deal.sharedContacts.customerName, deal.sharedContacts.customerPhone);

  return (
    <View style={styles.dealCard}>
      <Text style={styles.dealTitle}>Режим сделки</Text>
      <Text style={styles.dealText}>
        {formatStatus(deal.depositStatus)} · {formatMoney(deal.depositAmount)} · {deal.depositPercent}%
      </Text>
      <Text style={styles.dealText}>
        {deal.contactAccess === "UNLOCKED"
          ? `Контакты открыты: ${primaryContact}`
          : role === "CUSTOMER"
            ? "Контакты откроются после подтверждения 10% депозита перевозчиком."
            : "Контакты откроются после проверки вашей платежки администратором."}
      </Text>
      {deal.depositVerificationNote ? <Text style={styles.dealMuted}>{deal.depositVerificationNote}</Text> : null}
      {order.timeline?.length ? (
        <View style={styles.timelineList}>
          {order.timeline.slice(0, 4).map((item) => (
            <Text key={item.id} style={styles.timelineItem}>
              {formatDateTime(item.createdAt)} · {item.message}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DispatchStatusCard({
  order,
  role,
}: {
  order: Order;
  role: "CUSTOMER" | "CARRIER";
}) {
  if (!order.dispatch) {
    return null;
  }

  const hasVehicle = Boolean(order.dispatch.vehicleBrand || order.dispatch.vehiclePlate);
  const hasDriver = Boolean(order.dispatch.driverName || order.dispatch.driverPhone);

  if (!order.dispatch.assigned && role === "CUSTOMER") {
    return null;
  }

  return (
    <View style={styles.dealCard}>
      <Text style={styles.dealTitle}>Выдача на рейс</Text>
      <Text style={styles.dealText}>
        {hasVehicle
          ? `${order.dispatch.vehicleBrand ?? "Машина"}${order.dispatch.vehiclePlate ? ` · ${order.dispatch.vehiclePlate}` : ""}`
          : "Машина еще не назначена"}
      </Text>
      <Text style={styles.dealMuted}>
        {hasDriver
          ? `${order.dispatch.driverName ?? "Водитель"}${order.dispatch.driverPhone ? ` · ${order.dispatch.driverPhone}` : ""}`
          : role === "CUSTOMER"
            ? "Контакты водителя откроются после подтверждения оплаты."
            : "Добавьте водителя и телефон, чтобы заявка была готова к подаче."}
      </Text>
    </View>
  );
}

function ClosingDocumentCard({ order }: { order: Order }) {
  if (!order.closingDocument) {
    return null;
  }

  const { closingDocument } = order;
  return (
    <View style={styles.documentCard}>
      <Text style={styles.documentTitle}>Карточка закрытия</Text>
      <Text style={styles.documentText}>
        {closingDocument.documentNumber} · {closingDocument.vehicle.label}
      </Text>
      <Text style={styles.documentText}>
        {formatMoney(closingDocument.financials.totalPrice)} · депозит {formatMoney(closingDocument.financials.depositAmount)} ·{" "}
        {formatStatus(closingDocument.financials.depositStatus)}
      </Text>
      <Text style={styles.documentMuted}>
        {closingDocument.checkpoints.depositVerifiedAtLabel
          ? `Оплата подтверждена: ${closingDocument.checkpoints.depositVerifiedAtLabel}`
          : closingDocument.checkpoints.customerConfirmedAtLabel
            ? `Заказ подтвержден: ${closingDocument.checkpoints.customerConfirmedAtLabel}`
            : `Создано: ${closingDocument.checkpoints.createdAtLabel ?? "сейчас"}`}
      </Text>
    </View>
  );
}

function LockedWorkspace({
  biometricEnabled,
  onUnlock,
}: {
  biometricEnabled: boolean;
  onUnlock: () => void;
}) {
  return (
    <ScreenScaffold>
      <HeroCard
        eyebrow="Security Lock"
        title="ARTUR PRO is locked"
        subtitle={
          biometricEnabled
            ? "Unlock with Face ID, Touch ID or device biometrics before you can view orders, offers and phone numbers."
            : "The secure workspace is paused until the device owner confirms access."
        }
      />
      <SectionCard>
        <SectionTitle
          title="Protected workspace"
          subtitle="Carrier contacts, customer trips and active order history stay hidden until you unlock the app."
        />
        <AppButton label="Unlock app" onPress={onUnlock} />
      </SectionCard>
    </ScreenScaffold>
  );
}

function GuestWorkspace({ bootstrap }: { bootstrap: BootstrapPayload }) {
  const { requestChallenge, verifyChallenge } = useSession();
  const [role, setRole] = useState<MobileRole>("CUSTOMER");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [pendingChallenge, setPendingChallenge] = useState<PendingChallenge | null>(null);

  const handleRequestChallenge = async () => {
    const validationError = validateGuestProfile(name, phone);
    if (validationError) {
      setNotice({ tone: "danger", message: validationError });
      return;
    }

    try {
      setIsSubmitting(true);
      setNotice(null);
      const challenge = await requestChallenge({ role, name, phone });
      setPendingChallenge({ ...challenge, role, name, phone });
      setCode("");
      setNotice({
        tone: "success",
        message:
          challenge.deliveryChannel === "TELEGRAM"
            ? "Verification code sent to Telegram for this phone."
            : challenge.debugCode
              ? `Verification code: ${challenge.debugCode}`
              : "Verification code generated. Enter it below to continue.",
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Failed to request verification code",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyChallenge = async () => {
    if (!pendingChallenge) {
      return;
    }

    const validationError = validateVerificationCode(code);
    if (validationError) {
      setNotice({ tone: "danger", message: validationError });
      return;
    }

    try {
      setIsSubmitting(true);
      setNotice(null);
      await verifyChallenge({
        challengeId: pendingChallenge.challengeId,
        code,
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Failed to verify the code",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenScaffold>
      <HeroCard
        eyebrow="ARTUR PRO"
        title="Защищенный транспортный контур"
        subtitle="Заявки заказчиков, парк перевозчиков, ставки и статусы рейсов собраны в одном мобильном потоке вместо разрозненных чатов."
        rightSlot={<StatusBadge label={`${bootstrap.regions.length} регионов в контуре`} />}
      />

      <View style={styles.metricGrid}>
        <MetricCard value={`${bootstrap.vehicleTypes.length}`} label="классов транспорта" />
        <MetricCard value={`${bootstrap.categories.length}`} label="сценариев заявок" />
        <MetricCard value={`${bootstrap.pricingRules.length}`} label="тарифных правил" />
      </View>

      <SectionCard>
        <SectionTitle title="Безопасный вход" subtitle="Запросите одноразовый код и подтвердите его перед входом в рабочий контур." />
        <ChoiceChips
          options={[
            { value: "CUSTOMER", label: "Заказчик" },
            { value: "CARRIER", label: "Перевозчик" },
          ]}
          value={role}
          onChange={(nextRole) => {
            setRole(nextRole as MobileRole);
            setNotice(null);
            setPendingChallenge(null);
            setCode("");
          }}
        />
        <Field
          label="Имя или компания"
          placeholder="Vector Logistics"
          value={name}
          onChangeText={(nextName) => {
            setName(nextName);
            if (pendingChallenge) {
              setPendingChallenge(null);
              setCode("");
            }
          }}
        />
        <Field
          label="Телефон"
          placeholder="+7 999 123-45-67"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={(nextPhone) => {
            setPhone(nextPhone);
            if (pendingChallenge) {
              setPendingChallenge(null);
              setCode("");
            }
          }}
        />
        {pendingChallenge ? (
          <Field
            label="Одноразовый код"
            placeholder="123456"
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
          />
        ) : null}
        {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}
        <View style={styles.buttonRow}>
          <AppButton
            label={isSubmitting ? "Запрашиваем..." : "Получить код"}
            onPress={handleRequestChallenge}
            disabled={isSubmitting}
          />
          {pendingChallenge ? (
            <AppButton
              label={isSubmitting ? "Проверяем..." : "Подтвердить и войти"}
              onPress={handleVerifyChallenge}
              variant="secondary"
              disabled={isSubmitting}
            />
          ) : null}
        </View>
      </SectionCard>

      <SectionCard>
        <SectionTitle title="База безопасности" subtitle="Приложение больше не открывает рабочую сессию только по номеру телефона." />
        <View style={styles.featureList}>
          <Text style={styles.featureItem}>Одноразовые коды подтверждают каждый новый вход.</Text>
          <Text style={styles.featureItem}>Серверные сессии можно обновлять, ротировать и отзывать.</Text>
          <Text style={styles.featureItem}>Биометрическая защита скрывает заявки и контакты после сворачивания приложения.</Text>
        </View>
      </SectionCard>
    </ScreenScaffold>
  );
}

function SecurityControls({
  biometricAvailable,
  biometricEnabled,
  onToggle,
}: {
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <View style={styles.securityCard}>
      <Text style={styles.securityTitle}>Защита приложения</Text>
      <Text style={styles.securityText}>
        {biometricAvailable
          ? biometricEnabled
            ? "Биометрическая блокировка включена. Приложение скрывает чувствительные данные после сворачивания."
            : "Включите Face ID / Touch ID для защиты заявок, контактов и истории рейсов."
          : "Биометрическая защита недоступна на этом устройстве или в текущем симуляторе."}
      </Text>
      {biometricAvailable ? (
        <AppButton
          label={biometricEnabled ? "Отключить биометрию" : "Включить биометрию"}
          onPress={() => onToggle(!biometricEnabled)}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

function CustomerWorkspace({ bootstrap, token }: { bootstrap: BootstrapPayload; token: string }) {
  const { user, signOut, refresh, biometricAvailable, biometricEnabled, setBiometricLockEnabled } = useSession();
  const [tab, setTab] = useState<CustomerTab>("brief");
  const [orders, setOrders] = useState<Order[]>([]);
  const [returnDrafts, setReturnDrafts] = useState<Record<number, ReturnDraft>>({});
  const [form, setForm] = useState<CustomerOrderForm>(() => createCustomerForm(bootstrap));
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [quotedFormKey, setQuotedFormKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reloadOrders = useCallback(async () => {
    try {
      setRefreshing(true);
      const payload = await mobileApi.customer.listOrders(token);
      startTransition(() => {
        setOrders(payload);
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось обновить заявки",
      });
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void reloadOrders();
  }, [reloadOrders]);

  const isCargoFlow = CARGO_TYPES.has(form.vehicleType);
  const customerQuoteKey = getCustomerQuoteKey(form);
  const customerOrderValidationError = validateCustomerOrderForm(form, isCargoFlow);
  const activeQuote = quotedFormKey === customerQuoteKey ? quote : null;
  const canSubmitCustomerOrder = !customerOrderValidationError && Boolean(activeQuote);

  const buildOrderPayload = (): CustomerOrderRequest => ({
    regionId: Number(form.regionId),
    categoryId: Number(form.categoryId),
    vehicleType: form.vehicleType,
    routeFrom: form.routeFrom,
    routeTo: form.routeTo,
    date: new Date(form.date).toISOString(),
    adultsCount: isCargoFlow ? undefined : parseNumber(form.adultsCount),
    childrenCount: isCargoFlow ? undefined : parseNumber(form.childrenCount),
    passengersCount: isCargoFlow ? undefined : parseNumber(form.passengersCount),
    cargoDescription: isCargoFlow ? form.cargoDescription : undefined,
    weight: isCargoFlow ? parseNumber(form.weight) : undefined,
    volume: isCargoFlow ? parseNumber(form.volume) : undefined,
    comment: form.comment || undefined,
  });

  const handleQuote = async () => {
    if (customerOrderValidationError) {
      setNotice({ tone: "danger", message: customerOrderValidationError });
      return;
    }

    try {
      setSubmitting(true);
      setNotice(null);
      const payload = await mobileApi.customer.quote(token, buildOrderPayload());
      setQuote(payload);
      setQuotedFormKey(customerQuoteKey);
      setNotice({ tone: "success", message: "Маршрут просчитан, можно отправлять заявку." });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось рассчитать маршрут",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateOrder = async () => {
    if (customerOrderValidationError) {
      setNotice({ tone: "danger", message: customerOrderValidationError });
      return;
    }

    if (!activeQuote) {
      setNotice({
        tone: "info",
        message: "Сначала нажмите «Рассчитать», чтобы проверить маршрут, дистанцию и рекомендованную цену.",
      });
      return;
    }

    try {
      setSubmitting(true);
      setNotice(null);
      const created = await mobileApi.customer.createOrder(token, buildOrderPayload());
      setQuote(null);
      setQuotedFormKey(null);
      setForm(createCustomerForm(bootstrap));
      await reloadOrders();
      startTransition(() => {
        setTab("orders");
      });
      setNotice({
        tone: "success",
        message: `Заявка #${created.id} отправлена перевозчикам.`,
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось создать заявку",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOfferAction = async (offer: OrderOffer, action: "accept" | "reject") => {
    try {
      if (action === "accept") {
        await mobileApi.customer.acceptOffer(token, offer.id);
      } else {
        await mobileApi.customer.rejectOffer(token, offer.id);
      }
      await reloadOrders();
      await refresh();
      setNotice({
        tone: "success",
        message: action === "accept" ? "Предложение принято." : "Предложение отклонено.",
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось обработать предложение",
      });
    }
  };

  const updateReturnDraft = (order: Order, patch: Partial<ReturnDraft>) => {
    setReturnDrafts((current) => ({
      ...current,
      [order.id]: {
        ...(current[order.id] ?? createReturnDraft(order)),
        ...patch,
      },
    }));
  };

  const handleRequestReturn = async (order: Order) => {
    const draft = returnDrafts[order.id] ?? createReturnDraft(order);
    const validationError = validateReturnDraft(draft);

    if (validationError) {
      setNotice({ tone: "danger", message: validationError });
      return;
    }

    try {
      setSubmitting(true);
      setNotice(null);
      const created = await mobileApi.customer.requestReturn(token, order.id, {
        date: new Date(draft.date).toISOString(),
        routeTo: draft.routeTo || order.routeFrom,
        comment: draft.comment || undefined,
      });
      await reloadOrders();
      startTransition(() => {
        setReturnDrafts((current) => ({
          ...current,
          [order.id]: createReturnDraft(order),
        }));
      });
      setNotice({
        tone: "success",
        message: `Обратный рейс создан: заявка #${created.id}.`,
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось создать обратный рейс",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const customerName = user?.customer?.name ?? "Заказчик";
  const activeOrders = orders.filter((order) => ["NEW", "AWAITING_DEPOSIT", "ACCEPTED", "IN_PROGRESS"].includes(order.status));
  const totalOffers = orders.reduce((sum, order) => sum + (order.offers?.length ?? 0), 0);

  return (
    <ScreenScaffold onRefresh={() => void reloadOrders()} refreshing={refreshing}>
      <HeroCard
        eyebrow="Кабинет заказчика"
        title={customerName}
        subtitle="Создавайте поездки и грузовые заявки, сравнивайте предложения и фиксируйте лучшего исполнителя прямо в приложении."
        rightSlot={<StatusBadge label={`${activeOrders.length} активных заявок`} />}
      />

      <View style={styles.metricGrid}>
        <MetricCard value={`${orders.length}`} label="заявок всего" />
        <MetricCard value={`${totalOffers}`} label="офферов от перевозчиков" />
        <MetricCard value={formatMoney(orders[0]?.price)} label="последний бюджет" />
      </View>

      <ChoiceChips
        options={[
          { value: "brief", label: "Сводка" },
          { value: "create", label: "Новая заявка" },
          { value: "orders", label: "Мои заявки" },
          { value: "profile", label: "Профиль" },
        ]}
        value={tab}
        onChange={(nextTab) => setTab(nextTab as CustomerTab)}
      />

      {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}

      {tab === "brief" ? (
        <SectionCard>
          <SectionTitle title="Контроль без диспетчерского шума" subtitle="Здесь виден реальный статус каждой заявки, а не разрозненные сообщения." />
          <View style={styles.featureList}>
            <Text style={styles.featureItem}>Свежие предложения по цене и времени подачи собираются внутри карточки заказа.</Text>
            <Text style={styles.featureItem}>Маршрут и рекомендованная цена считаются до отправки заявки.</Text>
            <Text style={styles.featureItem}>После принятия оффера заказ переходит в исполнение без ручных таблиц.</Text>
          </View>
        </SectionCard>
      ) : null}

      {tab === "create" ? (
        <SectionCard>
          <SectionTitle title="Новая заявка" subtitle="Соберите заказ под автобус, микроавтобус или грузовой транспорт." />
          <ChoiceChips
            options={bootstrap.vehicleTypes.map((item) => ({ value: item.value, label: item.label }))}
            value={form.vehicleType}
            onChange={(vehicleType) => setForm((current) => ({ ...current, vehicleType }))}
          />
          <ChoiceChips
            options={bootstrap.regions.map((item) => ({ value: String(item.id), label: item.name }))}
            value={form.regionId}
            onChange={(regionId) => setForm((current) => ({ ...current, regionId }))}
          />
          <ChoiceChips
            options={bootstrap.categories.map((item) => ({ value: String(item.id), label: item.name }))}
            value={form.categoryId}
            onChange={(categoryId) => setForm((current) => ({ ...current, categoryId }))}
          />
          <Field label="Откуда" placeholder="Казань, ул. Петербургская, 1" value={form.routeFrom} onChangeText={(routeFrom) => setForm((current) => ({ ...current, routeFrom }))} />
          <Field label="Куда" placeholder="Аэропорт / склад / адрес клиента" value={form.routeTo} onChangeText={(routeTo) => setForm((current) => ({ ...current, routeTo }))} />
          <Field label="Дата и время" placeholder="2026-05-17T18:30" value={form.date} onChangeText={(date) => setForm((current) => ({ ...current, date }))} />
          {isCargoFlow ? (
            <>
              <Field label="Описание груза" placeholder="Паллеты, стройматериалы, оборудование" value={form.cargoDescription} onChangeText={(cargoDescription) => setForm((current) => ({ ...current, cargoDescription }))} />
              <Field label="Вес, кг" keyboardType="numeric" placeholder="950" value={form.weight} onChangeText={(weight) => setForm((current) => ({ ...current, weight }))} />
              <Field label="Объем, м3" keyboardType="numeric" placeholder="14.5" value={form.volume} onChangeText={(volume) => setForm((current) => ({ ...current, volume }))} />
            </>
          ) : (
            <>
              <Field label="Взрослые" keyboardType="numeric" value={form.adultsCount} onChangeText={(adultsCount) => setForm((current) => ({ ...current, adultsCount }))} />
              <Field label="Дети" keyboardType="numeric" value={form.childrenCount} onChangeText={(childrenCount) => setForm((current) => ({ ...current, childrenCount }))} />
              <Field label="Всего пассажиров" keyboardType="numeric" value={form.passengersCount} onChangeText={(passengersCount) => setForm((current) => ({ ...current, passengersCount }))} />
            </>
          )}
          <Field label="Комментарий" placeholder="Точка встречи, пропуск, пожелания по подаче" value={form.comment} onChangeText={(comment) => setForm((current) => ({ ...current, comment }))} multiline />
          {activeQuote ? (
            <Banner tone="info" message={`Расчет: ${formatDistance(activeQuote.route.estimatedDistanceKm)} · рекомендованная цена ${formatMoney(activeQuote.suggestedPrice)}`} />
          ) : (
            <Banner tone="info" message="Сначала заполните маршрут и нажмите «Рассчитать». После этого станет понятна дистанция и ориентир по цене." />
          )}
          <View style={styles.buttonRow}>
            <AppButton label={submitting ? "Считаю..." : "Рассчитать"} onPress={handleQuote} disabled={submitting} />
            <AppButton
              label={submitting ? "Отправляю..." : "Отправить заявку"}
              onPress={handleCreateOrder}
              variant="secondary"
              disabled={submitting || !canSubmitCustomerOrder}
            />
          </View>
        </SectionCard>
      ) : null}

      {tab === "orders" ? (
        <View style={styles.stack}>
          {orders.length === 0 ? (
            <SectionCard>
              <EmptyState title="Пока нет заявок" text="Создайте первую заявку и система сразу начнет собирать предложения перевозчиков." />
            </SectionCard>
          ) : (
            orders.map((order) => (
              <SectionCard key={order.id}>
                <View style={styles.orderHeader}>
                  <View style={styles.orderHeaderCopy}>
                    <Text style={styles.orderTitle}>Заявка #{order.id}</Text>
                    <Text style={styles.orderSubtitle}>
                      {order.routeFrom}
                      {" -> "}
                      {order.routeTo}
                    </Text>
                  </View>
                  <StatusBadge label={formatStatus(order.status)} />
                </View>
                <Text style={styles.orderMeta}>Подача: {formatDateTime(order.date)}</Text>
                <Text style={styles.orderMeta}>Бюджет: {formatMoney(order.price)} · {formatDistance(order.estimatedDistanceKm)}</Text>
                <Text style={styles.orderMeta}>Тип: {order.vehicleType}</Text>
                <DealStatusCard order={order} role="CUSTOMER" />
                <DispatchStatusCard order={order} role="CUSTOMER" />
                <ClosingDocumentCard order={order} />
                {order.returnTrip?.isReturnOrder ? (
                  <View style={styles.documentCard}>
                    <Text style={styles.documentTitle}>Обратный рейс</Text>
                    <Text style={styles.documentText}>
                      Связан с заявкой #{order.returnTrip.sourceOrderId} · {formatStatus(order.status)}
                    </Text>
                  </View>
                ) : null}
                {order.returnTrip?.linkedReturnOrderId ? (
                  <View style={styles.documentCard}>
                    <Text style={styles.documentTitle}>Обратный рейс уже создан</Text>
                    <Text style={styles.documentText}>
                      Заявка #{order.returnTrip.linkedReturnOrderId} · {formatStatus(order.returnTrip.linkedReturnStatus ?? "NEW")}
                    </Text>
                    <Text style={styles.documentMuted}>Подача: {formatDateTime(order.returnTrip.linkedReturnDate ?? null)}</Text>
                  </View>
                ) : ["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(order.status) ? (
                  <View style={styles.documentCard}>
                    <Text style={styles.documentTitle}>Заказать обратный рейс</Text>
                    <Field
                      label="Дата и время обратно"
                      placeholder="2026-05-19T18:30"
                      value={(returnDrafts[order.id] ?? createReturnDraft(order)).date}
                      onChangeText={(date) => updateReturnDraft(order, { date })}
                    />
                    <Field
                      label="Куда везти обратно"
                      placeholder={order.routeFrom}
                      value={(returnDrafts[order.id] ?? createReturnDraft(order)).routeTo}
                      onChangeText={(routeTo) => updateReturnDraft(order, { routeTo })}
                    />
                    <Field
                      label="Комментарий"
                      placeholder="Обратно после встречи, позвонить за 10 минут"
                      value={(returnDrafts[order.id] ?? createReturnDraft(order)).comment}
                      onChangeText={(comment) => updateReturnDraft(order, { comment })}
                      multiline
                    />
                    <AppButton
                      label={submitting ? "Создаю..." : "Создать обратный рейс"}
                      onPress={() => void handleRequestReturn(order)}
                      variant="secondary"
                      disabled={submitting}
                    />
                  </View>
                ) : null}
                {order.offers?.length ? (
                  <View style={styles.offerStack}>
                    {order.offers.map((offer) => (
                      <View key={offer.id} style={styles.offerCard}>
                        <Text style={styles.offerTitle}>
                          {offer.carrier?.fullName || `Перевозчик #${offer.carrierId}`} · {formatMoney(offer.proposedPrice)}
                        </Text>
                        <Text style={styles.offerText}>Подача: {offer.pickupEtaText || "уточняется"} · {formatStatus(offer.status)}</Text>
                        <Text style={styles.offerText}>{offer.note || "Без дополнительного комментария"}</Text>
                        {["ACTIVE", "COUNTERED"].includes(offer.status) ? (
                          <View style={styles.buttonRow}>
                            <AppButton label="Принять" onPress={() => void handleOfferAction(offer, "accept")} />
                            <AppButton label="Отклонить" onPress={() => void handleOfferAction(offer, "reject")} variant="ghost" />
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : (
                  <EmptyState title="Предложений пока нет" text="Перевозчики еще подбирают цену и время подачи." />
                )}
              </SectionCard>
            ))
          )}
        </View>
      ) : null}

      {tab === "profile" ? (
        <SectionCard>
          <SectionTitle title="Профиль" subtitle="Сессия сохраняется в защищенном хранилище устройства." />
          <Text style={styles.profileText}>Имя: {customerName}</Text>
          <Text style={styles.profileText}>Телефон: {user?.phone ?? "не указан"}</Text>
          <Text style={styles.profileText}>Роль: заказчик</Text>
          <SecurityControls
            biometricAvailable={biometricAvailable}
            biometricEnabled={biometricEnabled}
            onToggle={(enabled) => {
              void setBiometricLockEnabled(enabled).then((result) => {
                if (!result) {
                  setNotice({
                    tone: "danger",
                    message: "Биометрическая защита недоступна или не была подтверждена.",
                  });
                  return;
                }

                setNotice({
                  tone: "success",
                  message: enabled ? "Биометрическая защита включена." : "Биометрическая защита отключена.",
                });
              });
            }}
          />
          <AppButton label="Выйти" onPress={() => void signOut()} variant="ghost" />
        </SectionCard>
      ) : null}
    </ScreenScaffold>
  );
}

function CarrierWorkspace({ bootstrap, token }: { bootstrap: BootstrapPayload; token: string }) {
  const { user, signOut, refresh, biometricAvailable, biometricEnabled, setBiometricLockEnabled } = useSession();
  const [tab, setTab] = useState<CarrierTab>("brief");
  const [profile, setProfile] = useState<CarrierProfile | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [registrationForm, setRegistrationForm] = useState<CarrierRegistrationForm>(() =>
    createCarrierRegistrationForm(bootstrap, {
      fullName: user?.carrier?.fullName,
      phone: user?.phone,
      vehicleType: user?.carrier?.vehicleType,
    })
  );
  const [vehicleForm, setVehicleForm] = useState<VehicleForm>(() => createVehicleForm(bootstrap));
  const [offerDrafts, setOfferDrafts] = useState<Record<number, OfferDraft>>({});
  const [depositDrafts, setDepositDrafts] = useState<Record<number, DepositDraft>>({});
  const [dispatchDrafts, setDispatchDrafts] = useState<Record<number, DispatchDraft>>({});
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const reloadWorkspace = useCallback(async () => {
    try {
      setRefreshing(true);
      const [nextProfile, nextVehicles, nextOpenOrders, nextActiveOrders, nextHistoryOrders] = await Promise.all([
        mobileApi.carrier.profile(token),
        mobileApi.carrier.vehicles(token),
        mobileApi.carrier.openOrders(token),
        mobileApi.carrier.activeOrders(token),
        mobileApi.carrier.historyOrders(token),
      ]);

      startTransition(() => {
        setProfile(nextProfile);
        setVehicles(nextVehicles);
        setOpenOrders(nextOpenOrders);
        setActiveOrders(nextActiveOrders);
        setHistoryOrders(nextHistoryOrders);
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось обновить кабинет перевозчика",
      });
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void reloadWorkspace();
  }, [reloadWorkspace]);

  useEffect(() => {
    setRegistrationForm((current) => ({
      ...current,
      fullName: profile?.fullName ?? user?.carrier?.fullName ?? current.fullName,
      phone: user?.phone ?? current.phone,
      regionId: String(profile?.regionId ?? Number(current.regionId || bootstrap.regions[0]?.id || 0)),
    }));
  }, [bootstrap.regions, profile?.fullName, profile?.regionId, user?.carrier?.fullName, user?.phone]);

  const updateOfferDraft = (orderId: number, patch: Partial<OfferDraft>) => {
    setOfferDrafts((current) => ({
      ...current,
      [orderId]: {
        proposedPrice: current[orderId]?.proposedPrice ?? "",
        pickupEtaText: current[orderId]?.pickupEtaText ?? "",
        note: current[orderId]?.note ?? "",
        ...patch,
      },
    }));
  };

  const updateDepositDraft = (orderId: number, patch: Partial<DepositDraft>) => {
    setDepositDrafts((current) => ({
      ...current,
      [orderId]: {
        paymentReference: current[orderId]?.paymentReference ?? "",
        note: current[orderId]?.note ?? "",
        ...patch,
      },
    }));
  };

  const updateDispatchDraft = (order: Order, patch: Partial<DispatchDraft>) => {
    setDispatchDrafts((current) => ({
      ...current,
      [order.id]: {
        ...(current[order.id] ?? createDispatchDraft(order)),
        ...patch,
      },
    }));
  };

  const handleRegister = async () => {
    const validationError = validateCarrierRegistrationForm(registrationForm);
    if (validationError) {
      setNotice({ tone: "danger", message: validationError });
      return;
    }

    try {
      setBusy(true);
      setNotice(null);
      await mobileApi.carrier.register(token, {
        fullName: registrationForm.fullName,
        phone: registrationForm.phone,
        regionIds: [Number(registrationForm.regionId)],
        vehicleType: registrationForm.vehicleType,
        brand: registrationForm.brand,
        capacity: Number(registrationForm.capacity),
        plateNumber: registrationForm.plateNumber,
        description: registrationForm.description,
        features: registrationForm.features || undefined,
      });
      await Promise.all([reloadWorkspace(), refresh()]);
      setNotice({ tone: "success", message: "Анкета перевозчика отправлена на модерацию или обновлена." });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось сохранить профиль перевозчика",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleProfileUpdate = async () => {
    const validationError = validateCarrierBaseProfile(registrationForm);
    if (validationError) {
      setNotice({ tone: "danger", message: validationError });
      return;
    }

    try {
      setBusy(true);
      setNotice(null);
      await mobileApi.carrier.updateProfile(token, {
        fullName: registrationForm.fullName,
        phone: registrationForm.phone,
        regionIds: [Number(registrationForm.regionId)],
      });
      await Promise.all([reloadWorkspace(), refresh()]);
      setNotice({ tone: "success", message: "Профиль обновлен." });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось обновить профиль",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAddVehicle = async () => {
    const validationError = validateVehicleForm(vehicleForm);
    if (validationError) {
      setNotice({ tone: "danger", message: validationError });
      return;
    }

    try {
      setBusy(true);
      setNotice(null);
      await mobileApi.carrier.addVehicle(token, {
        vehicleType: vehicleForm.vehicleType,
        brand: vehicleForm.brand,
        capacity: Number(vehicleForm.capacity),
        plateNumber: vehicleForm.plateNumber,
        description: vehicleForm.description,
        features: vehicleForm.features || undefined,
      });
      setVehicleForm(createVehicleForm(bootstrap));
      await reloadWorkspace();
      setNotice({ tone: "success", message: "Новая машина добавлена в парк." });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось добавить транспорт",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleVehicleToggle = async (vehicle: Vehicle) => {
    try {
      setBusy(true);
      await mobileApi.carrier.updateVehicle(token, vehicle.id, {
        vehicleType: vehicle.type,
        brand: vehicle.brand,
        capacity: vehicle.capacity ?? 1,
        plateNumber: vehicle.plateNumber,
        description: vehicle.description ?? vehicle.brand,
        features: vehicle.features ?? undefined,
        isActive: !vehicle.isActive,
      });
      await reloadWorkspace();
      setNotice({
        tone: "success",
        message: vehicle.isActive ? "Машина выведена из активного парка." : "Машина снова доступна для заявок.",
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось обновить статус машины",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSendOffer = async (orderId: number) => {
    const draft = offerDrafts[orderId];
    const validationError = validateOfferDraft(draft);

    if (validationError) {
      setNotice({ tone: "danger", message: validationError });
      return;
    }

    try {
      setBusy(true);
      setNotice(null);
      await mobileApi.carrier.createOffer(token, orderId, {
        proposedPrice: Number(draft?.proposedPrice),
        pickupEtaText: draft?.pickupEtaText || undefined,
        note: draft?.note || undefined,
      });
      await reloadWorkspace();
      setOfferDrafts((current) => ({ ...current, [orderId]: { proposedPrice: "", pickupEtaText: "", note: "" } }));
      setNotice({ tone: "success", message: `Оффер по заявке #${orderId} отправлен.` });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось отправить оффер",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitDeposit = async (orderId: number) => {
    const draft = depositDrafts[orderId];
    const validationError = validateDepositDraft(draft);

    if (validationError) {
      setNotice({ tone: "danger", message: validationError });
      return;
    }

    try {
      setBusy(true);
      setNotice(null);
      await mobileApi.carrier.submitDeposit(token, orderId, {
        paymentReference: draft?.paymentReference,
        note: draft?.note || undefined,
      });
      await reloadWorkspace();
      setNotice({
        tone: "success",
        message: `Платежка по заявке #${orderId} отправлена на проверку.`,
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось отправить платежку на проверку",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAssignDispatch = async (order: Order) => {
    const draft = dispatchDrafts[order.id] ?? createDispatchDraft(order);
    const matchingVehicles = vehicles.filter(
      (vehicle) => vehicle.isActive && (vehicle.type === order.vehicleType || vehicle.id === order.vehicle?.id)
    );
    const validationError = validateDispatchDraft(draft, matchingVehicles);

    if (validationError) {
      setNotice({ tone: "danger", message: validationError });
      return;
    }

    try {
      setBusy(true);
      setNotice(null);
      await mobileApi.carrier.assignDispatch(token, order.id, {
        vehicleId: parseNumber(draft.vehicleId),
        driverName: draft.driverName,
        driverPhone: draft.driverPhone,
      });
      await reloadWorkspace();
      setNotice({
        tone: "success",
        message: `Водитель и машина по заявке #${order.id} назначены.`,
      });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось назначить выдачу на рейс",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleStatusUpdate = async (orderId: number, status: CarrierOrderStatus) => {
    try {
      setBusy(true);
      setNotice(null);
      await mobileApi.carrier.updateOrderStatus(token, orderId, status);
      await reloadWorkspace();
      setNotice({ tone: "success", message: `Статус заявки #${orderId} обновлен.` });
    } catch (error) {
      setNotice({
        tone: "danger",
        message: error instanceof Error ? error.message : "Не удалось обновить статус заявки",
      });
    } finally {
      setBusy(false);
    }
  };

  const carrierStatus = profile?.status ?? user?.carrier?.status ?? "PENDING_APPROVAL";
  const activeFleet = vehicles.filter((vehicle) => vehicle.isActive).length;
  const regionName = profile?.region?.name ?? user?.carrier?.region?.name ?? "регион не выбран";

  return (
    <ScreenScaffold onRefresh={() => void reloadWorkspace()} refreshing={refreshing}>
      <HeroCard
        eyebrow="Кабинет перевозчика"
        title={profile?.fullName ?? user?.carrier?.fullName ?? "Партнер ARTUR PRO"}
        subtitle={`Статус: ${formatStatus(carrierStatus)}. Рабочий регион: ${regionName}. Подключайте парк, отвечайте на заявки и ведите рейс до закрытия.`}
        rightSlot={<StatusBadge label={`${openOrders.length} открытых заявок`} />}
      />

      <View style={styles.metricGrid}>
        <MetricCard value={`${activeFleet}/${vehicles.length}`} label="машин в активном парке" />
        <MetricCard value={`${activeOrders.length}`} label="заявок в работе" />
        <MetricCard value={`${historyOrders.length}`} label="закрытых заказов" />
      </View>

      <ChoiceChips
        options={[
          { value: "brief", label: "Сводка" },
          { value: "open", label: "Открытые" },
          { value: "active", label: "В работе" },
          { value: "fleet", label: "Парк" },
          { value: "profile", label: "Профиль" },
        ]}
        value={tab}
        onChange={(nextTab) => setTab(nextTab as CarrierTab)}
      />

      {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}
      {carrierStatus !== "APPROVED" ? (
        <Banner
          tone="info"
          message={`Профиль перевозчика пока в статусе «${formatStatus(carrierStatus)}». Новые заявки появятся после модерации и проверки анкеты.`}
        />
      ) : null}

      {tab === "brief" ? (
        <>
          <SectionCard>
            <SectionTitle title="Как зарабатывать через приложение" subtitle="Новая заявка попадает в ленту, перевозчик отправляет оффер и дальше ведет исполнение внутри заказа." />
            <View style={styles.featureList}>
              <Text style={styles.featureItem}>Никаких отдельных чатов с уточнениями по цене и времени подачи.</Text>
              <Text style={styles.featureItem}>История активных и завершенных рейсов остается в одном интерфейсе.</Text>
              <Text style={styles.featureItem}>Парк и регионы можно менять без участия админа.</Text>
            </View>
          </SectionCard>

          {carrierStatus !== "APPROVED" ? (
            <SectionCard>
              <SectionTitle title="Завершите анкету перевозчика" subtitle="После заполнения можно проходить модерацию и получать подходящие заявки." />
              <CarrierRegistrationFields bootstrap={bootstrap} form={registrationForm} onChange={setRegistrationForm} />
              <AppButton label={busy ? "Сохраняю..." : "Сохранить анкету"} onPress={handleRegister} disabled={busy} />
            </SectionCard>
          ) : null}
        </>
      ) : null}

      {tab === "open" ? (
        <View style={styles.stack}>
          {openOrders.length === 0 ? (
            <SectionCard>
              <EmptyState
                title={carrierStatus === "APPROVED" ? "Подходящих заявок пока нет" : "Профиль еще не допущен к заявкам"}
                text={
                  carrierStatus === "APPROVED"
                    ? "Как только появится новый заказ по вашим регионам и типам транспорта, он отобразится здесь."
                    : "Завершите анкету и дождитесь модерации. После одобрения здесь появятся новые заявки по вашим регионам и типам транспорта."
                }
              />
            </SectionCard>
          ) : (
            openOrders.map((order) => {
              const draft = offerDrafts[order.id] ?? { proposedPrice: "", pickupEtaText: "", note: "" };
              return (
                <SectionCard key={order.id}>
                  <View style={styles.orderHeader}>
                    <View style={styles.orderHeaderCopy}>
                      <Text style={styles.orderTitle}>Заявка #{order.id}</Text>
                      <Text style={styles.orderSubtitle}>
                        {order.routeFrom}
                        {" -> "}
                        {order.routeTo}
                      </Text>
                    </View>
                    <StatusBadge label={formatMoney(order.price)} />
                  </View>
                  <Text style={styles.orderMeta}>Подача: {formatDateTime(order.date)}</Text>
                  <Text style={styles.orderMeta}>Тип: {order.vehicleType} · {formatDistance(order.estimatedDistanceKm)}</Text>
                  <Text style={styles.orderMeta}>Комментарий: {order.comment || "без комментария"}</Text>
                  <Field label="Цена оффера" keyboardType="numeric" placeholder="4500" value={draft.proposedPrice} onChangeText={(proposedPrice) => updateOfferDraft(order.id, { proposedPrice })} />
                  <Field label="Время подачи" placeholder="15 минут" value={draft.pickupEtaText} onChangeText={(pickupEtaText) => updateOfferDraft(order.id, { pickupEtaText })} />
                  <Field label="Комментарий к офферу" placeholder="Свободны сразу, автобус после мойки" value={draft.note} onChangeText={(note) => updateOfferDraft(order.id, { note })} multiline />
                  <AppButton label={busy ? "Отправляю..." : "Отправить оффер"} onPress={() => void handleSendOffer(order.id)} disabled={busy} />
                </SectionCard>
              );
            })
          )}
        </View>
      ) : null}

      {tab === "active" ? (
        <View style={styles.stack}>
          {activeOrders.length === 0 ? (
            <SectionCard>
              <EmptyState title="Активных рейсов нет" text="Принятые заявки автоматически появятся здесь." />
            </SectionCard>
          ) : (
            activeOrders.map((order) => {
              const dispatchDraft = dispatchDrafts[order.id] ?? createDispatchDraft(order);
              const matchingVehicles = vehicles.filter(
                (vehicle) => vehicle.isActive && (vehicle.type === order.vehicleType || vehicle.id === order.vehicle?.id)
              );

              return (
                <SectionCard key={order.id}>
                  <View style={styles.orderHeader}>
                    <View style={styles.orderHeaderCopy}>
                      <Text style={styles.orderTitle}>Заявка #{order.id}</Text>
                      <Text style={styles.orderSubtitle}>
                        {order.routeFrom}
                        {" -> "}
                        {order.routeTo}
                      </Text>
                    </View>
                    <StatusBadge label={formatStatus(order.status)} />
                  </View>
                  <Text style={styles.orderMeta}>Дата: {formatDateTime(order.date)}</Text>
                  <Text style={styles.orderMeta}>Стоимость: {formatMoney(order.price)}</Text>
                  <DealStatusCard order={order} role="CARRIER" />
                  <DispatchStatusCard order={order} role="CARRIER" />
                  <ClosingDocumentCard order={order} />
                  <View style={styles.documentCard}>
                    <Text style={styles.documentTitle}>Назначить выдачу</Text>
                    {matchingVehicles.length ? (
                      <ChoiceChips
                        options={matchingVehicles.map((vehicle) => ({
                          value: String(vehicle.id),
                          label: `${vehicle.brand} · ${vehicle.plateNumber}`,
                        }))}
                        value={dispatchDraft.vehicleId}
                        onChange={(vehicleId) => updateDispatchDraft(order, { vehicleId })}
                      />
                    ) : null}
                    <Field
                      label="Водитель"
                      placeholder="Иван Петров"
                      value={dispatchDraft.driverName}
                      onChangeText={(driverName) => updateDispatchDraft(order, { driverName })}
                    />
                    <Field
                      label="Телефон водителя"
                      placeholder="+7 999 123-45-67"
                      keyboardType="phone-pad"
                      value={dispatchDraft.driverPhone}
                      onChangeText={(driverPhone) => updateDispatchDraft(order, { driverPhone })}
                    />
                    <AppButton
                      label={busy ? "Сохраняю..." : "Сохранить водителя и машину"}
                      onPress={() => void handleAssignDispatch(order)}
                      variant="secondary"
                      disabled={busy}
                    />
                  </View>
                  {order.status === "AWAITING_DEPOSIT" ? (
                    <>
                      <Field
                        label="Платежный номер / ссылка"
                        placeholder="PAY-2026-0519-01"
                        value={depositDrafts[order.id]?.paymentReference ?? ""}
                        onChangeText={(paymentReference) => updateDepositDraft(order.id, { paymentReference })}
                      />
                      <Field
                        label="Комментарий к платежке"
                        placeholder="Оплатил с расчетного счета, жду подтверждение"
                        value={depositDrafts[order.id]?.note ?? ""}
                        onChangeText={(note) => updateDepositDraft(order.id, { note })}
                        multiline
                      />
                      <AppButton
                        label={busy ? "Отправляю..." : "Отправить платежку"}
                        onPress={() => void handleSubmitDeposit(order.id)}
                        disabled={busy}
                      />
                    </>
                  ) : null}
                  <View style={styles.buttonRow}>
                    {order.status === "ACCEPTED" ? (
                      <AppButton label="Начать рейс" onPress={() => void handleStatusUpdate(order.id, "IN_PROGRESS")} disabled={busy} />
                    ) : null}
                    {order.status === "IN_PROGRESS" ? (
                      <AppButton label="Завершить рейс" onPress={() => void handleStatusUpdate(order.id, "COMPLETED")} disabled={busy} variant="secondary" />
                    ) : null}
                  </View>
                </SectionCard>
              );
            })
          )}

          {historyOrders.length ? (
            <SectionCard>
              <SectionTitle title="Недавняя история" subtitle="Последние завершенные или отмененные заказы." />
              <View style={styles.featureList}>
                {historyOrders.slice(0, 5).map((order) => (
                  <Text key={order.id} style={styles.featureItem}>
                    #{order.id} · {formatStatus(order.status)} · {formatMoney(order.price)} · {formatDateTime(order.date)}
                  </Text>
                ))}
              </View>
            </SectionCard>
          ) : null}
        </View>
      ) : null}

      {tab === "fleet" ? (
        <View style={styles.stack}>
          <SectionCard>
            <SectionTitle title="Добавить машину" subtitle="Чем точнее парк, тем больше релевантных заявок увидит перевозчик." />
            <ChoiceChips
              options={bootstrap.vehicleTypes.map((item) => ({ value: item.value, label: item.label }))}
              value={vehicleForm.vehicleType}
              onChange={(vehicleType) => setVehicleForm((current) => ({ ...current, vehicleType }))}
            />
            <Field label="Марка / модель" placeholder="Mercedes Sprinter" value={vehicleForm.brand} onChangeText={(brand) => setVehicleForm((current) => ({ ...current, brand }))} />
            <Field label="Вместимость" keyboardType="numeric" placeholder="19" value={vehicleForm.capacity} onChangeText={(capacity) => setVehicleForm((current) => ({ ...current, capacity }))} />
            <Field label="Госномер" placeholder="A123AA116" value={vehicleForm.plateNumber} onChangeText={(plateNumber) => setVehicleForm((current) => ({ ...current, plateNumber }))} />
            <Field label="Описание" placeholder="Кондиционер, мягкие кресла, багажный отсек" value={vehicleForm.description} onChangeText={(description) => setVehicleForm((current) => ({ ...current, description }))} multiline />
            <Field label="Особенности" placeholder="Wi-Fi, тахограф, ремни безопасности" value={vehicleForm.features} onChangeText={(features) => setVehicleForm((current) => ({ ...current, features }))} multiline />
            <AppButton label={busy ? "Добавляю..." : "Добавить в парк"} onPress={handleAddVehicle} disabled={busy} />
          </SectionCard>

          {vehicles.map((vehicle) => (
            <SectionCard key={vehicle.id}>
              <View style={styles.orderHeader}>
                <View style={styles.orderHeaderCopy}>
                  <Text style={styles.orderTitle}>{vehicle.brand}</Text>
                  <Text style={styles.orderSubtitle}>{vehicle.plateNumber}</Text>
                </View>
                <StatusBadge label={vehicle.isActive ? "Активна" : "Отключена"} />
              </View>
              <Text style={styles.orderMeta}>Тип: {vehicle.type} · Вместимость: {vehicle.capacity ?? "не указана"}</Text>
              <Text style={styles.orderMeta}>{vehicle.description || "Описание не заполнено"}</Text>
              <AppButton
                label={vehicle.isActive ? "Вывести из парка" : "Вернуть в парк"}
                onPress={() => void handleVehicleToggle(vehicle)}
                variant="ghost"
                disabled={busy}
              />
            </SectionCard>
          ))}
        </View>
      ) : null}

      {tab === "profile" ? (
        <SectionCard>
          <SectionTitle title="Профиль перевозчика" subtitle="Обновляйте контакты и основной регион без обращения к администратору." />
          <Field label="ФИО / компания" value={registrationForm.fullName} onChangeText={(fullName) => setRegistrationForm((current) => ({ ...current, fullName }))} />
          <Field label="Телефон" keyboardType="phone-pad" value={registrationForm.phone} onChangeText={(phone) => setRegistrationForm((current) => ({ ...current, phone }))} />
          <ChoiceChips
            options={bootstrap.regions.map((item) => ({ value: String(item.id), label: item.name }))}
            value={registrationForm.regionId}
            onChange={(regionId) => setRegistrationForm((current) => ({ ...current, regionId }))}
          />
          <Text style={styles.profileText}>Текущий статус: {formatStatus(carrierStatus)}</Text>
          <SecurityControls
            biometricAvailable={biometricAvailable}
            biometricEnabled={biometricEnabled}
            onToggle={(enabled) => {
              void setBiometricLockEnabled(enabled).then((result) => {
                if (!result) {
                  setNotice({
                    tone: "danger",
                    message: "Биометрическая защита недоступна или не была подтверждена.",
                  });
                  return;
                }

                setNotice({
                  tone: "success",
                  message: enabled ? "Биометрическая защита включена." : "Биометрическая защита отключена.",
                });
              });
            }}
          />
          <View style={styles.buttonRow}>
            <AppButton label={busy ? "Сохраняю..." : "Обновить профиль"} onPress={handleProfileUpdate} disabled={busy} />
            <AppButton label="Выйти" onPress={() => void signOut()} variant="ghost" />
          </View>
        </SectionCard>
      ) : null}
    </ScreenScaffold>
  );
}

function CarrierRegistrationFields({
  bootstrap,
  form,
  onChange,
}: {
  bootstrap: BootstrapPayload;
  form: CarrierRegistrationForm;
  onChange: React.Dispatch<React.SetStateAction<CarrierRegistrationForm>>;
}) {
  return (
    <View style={styles.stack}>
      <Field label="ФИО / компания" value={form.fullName} onChangeText={(fullName) => onChange((current) => ({ ...current, fullName }))} />
      <Field label="Телефон" keyboardType="phone-pad" value={form.phone} onChangeText={(phone) => onChange((current) => ({ ...current, phone }))} />
      <ChoiceChips
        options={bootstrap.regions.map((item) => ({ value: String(item.id), label: item.name }))}
        value={form.regionId}
        onChange={(regionId) => onChange((current) => ({ ...current, regionId }))}
      />
      <ChoiceChips
        options={bootstrap.vehicleTypes.map((item) => ({ value: item.value, label: item.label }))}
        value={form.vehicleType}
        onChange={(vehicleType) => onChange((current) => ({ ...current, vehicleType }))}
      />
      <Field label="Марка / модель" placeholder="King Long / MAN / ГАЗель" value={form.brand} onChangeText={(brand) => onChange((current) => ({ ...current, brand }))} />
      <Field label="Вместимость" keyboardType="numeric" placeholder="18" value={form.capacity} onChangeText={(capacity) => onChange((current) => ({ ...current, capacity }))} />
      <Field label="Госномер" placeholder="A123AA116" value={form.plateNumber} onChangeText={(plateNumber) => onChange((current) => ({ ...current, plateNumber }))} />
      <Field label="Описание" placeholder="Микроавтобус для корпоративной развозки, кондиционер, багаж" value={form.description} onChangeText={(description) => onChange((current) => ({ ...current, description }))} multiline />
      <Field label="Особенности" placeholder="Wi-Fi, детские кресла, ремни безопасности" value={form.features} onChangeText={(features) => onChange((current) => ({ ...current, features }))} multiline />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.chalk,
  },
  root: {
    flex: 1,
    backgroundColor: Palette.chalk,
  },
  keyboardWrap: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: AppSpacing.lg,
    paddingVertical: AppSpacing.lg,
    gap: AppSpacing.lg,
  },
  orbOne: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: Palette.blush,
    top: -50,
    right: -70,
    opacity: 0.75,
  },
  orbTwo: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: Palette.sand,
    bottom: 30,
    left: -90,
    opacity: 0.55,
  },
  heroCard: {
    backgroundColor: Palette.smoke,
    borderRadius: 28,
    padding: AppSpacing.xl,
    gap: AppSpacing.md,
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: AppSpacing.md,
  },
  heroCopy: {
    flex: 1,
    gap: AppSpacing.sm,
  },
  heroRightSlot: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  eyebrow: {
    color: Palette.sand,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  heroTitle: {
    color: Palette.chalk,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
  },
  heroText: {
    color: "#d8dfda",
    fontSize: 15,
    lineHeight: 22,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: AppSpacing.md,
  },
  metricCard: {
    flexGrow: 1,
    minWidth: 100,
    backgroundColor: Palette.panel,
    borderRadius: 22,
    padding: AppSpacing.lg,
    borderWidth: 1,
    borderColor: Palette.line,
    gap: AppSpacing.xs,
  },
  metricValue: {
    color: Palette.ink,
    fontSize: 24,
    fontWeight: "800",
  },
  metricLabel: {
    color: Palette.slate,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 24,
    padding: AppSpacing.lg,
    gap: AppSpacing.md,
    borderWidth: 1,
    borderColor: Palette.line,
  },
  sectionTitleWrap: {
    gap: AppSpacing.xs,
  },
  sectionTitle: {
    color: Palette.ink,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
  },
  sectionSubtitle: {
    color: Palette.slate,
    fontSize: 14,
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: AppSpacing.sm,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: Palette.fog,
    borderWidth: 1,
    borderColor: Palette.line,
  },
  chipActive: {
    backgroundColor: Palette.moss,
    borderColor: Palette.moss,
  },
  chipText: {
    color: Palette.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  chipTextActive: {
    color: Palette.chalk,
  },
  fieldWrap: {
    gap: AppSpacing.xs,
  },
  fieldLabel: {
    color: Palette.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: Palette.line,
    borderRadius: 18,
    paddingHorizontal: AppSpacing.md,
    paddingVertical: 14,
    color: Palette.ink,
    backgroundColor: Palette.panel,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  banner: {
    borderRadius: 18,
    paddingHorizontal: AppSpacing.md,
    paddingVertical: AppSpacing.md,
  },
  bannerDanger: {
    backgroundColor: "#fde1dc",
  },
  bannerSuccess: {
    backgroundColor: "#dcefe7",
  },
  bannerInfo: {
    backgroundColor: "#e2eef1",
  },
  bannerText: {
    color: Palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: AppSpacing.sm,
  },
  button: {
    minHeight: 50,
    borderRadius: 18,
    paddingHorizontal: 18,
    justifyContent: "center",
    alignItems: "center",
    flexGrow: 1,
  },
  buttonPrimary: {
    backgroundColor: Palette.amber,
  },
  buttonSecondary: {
    backgroundColor: Palette.sea,
  },
  buttonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Palette.line,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "800",
  },
  buttonSolidText: {
    color: Palette.chalk,
  },
  buttonGhostText: {
    color: Palette.ink,
  },
  buttonTextDisabled: {
    color: "#ebe4d8",
  },
  featureList: {
    gap: AppSpacing.sm,
  },
  featureItem: {
    color: Palette.ink,
    fontSize: 15,
    lineHeight: 21,
  },
  stack: {
    gap: AppSpacing.md,
  },
  statusBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#efe6d2",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusBadgeText: {
    color: Palette.smoke,
    fontSize: 12,
    fontWeight: "800",
  },
  emptyState: {
    gap: AppSpacing.xs,
    paddingVertical: AppSpacing.sm,
  },
  emptyStateTitle: {
    color: Palette.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  emptyStateText: {
    color: Palette.slate,
    fontSize: 14,
    lineHeight: 20,
  },
  orderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: AppSpacing.md,
  },
  orderHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  orderTitle: {
    color: Palette.ink,
    fontSize: 18,
    fontWeight: "800",
  },
  orderSubtitle: {
    color: Palette.slate,
    fontSize: 14,
    lineHeight: 20,
  },
  orderMeta: {
    color: Palette.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  offerStack: {
    gap: AppSpacing.sm,
  },
  offerCard: {
    backgroundColor: Palette.fog,
    borderRadius: 18,
    padding: AppSpacing.md,
    gap: AppSpacing.sm,
  },
  offerTitle: {
    color: Palette.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  offerText: {
    color: Palette.slate,
    fontSize: 14,
    lineHeight: 20,
  },
  profileText: {
    color: Palette.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  securityCard: {
    gap: AppSpacing.sm,
    padding: AppSpacing.md,
    borderRadius: 18,
    backgroundColor: Palette.fog,
  },
  securityTitle: {
    color: Palette.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  securityText: {
    color: Palette.slate,
    fontSize: 14,
    lineHeight: 20,
  },
  dealCard: {
    gap: AppSpacing.xs,
    padding: AppSpacing.md,
    borderRadius: 18,
    backgroundColor: Palette.fog,
  },
  dealTitle: {
    color: Palette.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  dealText: {
    color: Palette.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  dealMuted: {
    color: Palette.slate,
    fontSize: 12,
    lineHeight: 18,
  },
  documentCard: {
    gap: AppSpacing.xs,
    padding: AppSpacing.md,
    borderRadius: 18,
    backgroundColor: "#f7f2e8",
    borderWidth: 1,
    borderColor: Palette.line,
  },
  documentTitle: {
    color: Palette.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  documentText: {
    color: Palette.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  documentMuted: {
    color: Palette.slate,
    fontSize: 12,
    lineHeight: 18,
  },
  timelineList: {
    gap: 6,
    marginTop: 4,
  },
  timelineItem: {
    color: Palette.slate,
    fontSize: 12,
    lineHeight: 18,
  },
});

export default TransportApp;
