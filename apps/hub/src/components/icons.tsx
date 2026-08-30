import type { ComponentProps, JSX } from "react";

import { ArrowDownLeftIcon as BaseArrowDownLeft } from "@phosphor-icons/react/dist/csr/ArrowDownLeft";
import { ArrowRightIcon as BaseArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowsClockwiseIcon as BaseArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { CalendarPlusIcon as BaseCalendarPlus } from "@phosphor-icons/react/dist/csr/CalendarPlus";
import { CaretLeftIcon as BaseCaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon as BaseCaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckIcon as BaseCheck } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircleIcon as BaseCheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockClockwiseIcon as BaseClockClockwise } from "@phosphor-icons/react/dist/csr/ClockClockwise";
import { ClockCounterClockwiseIcon as BaseClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CopyIcon as BaseCopy } from "@phosphor-icons/react/dist/csr/Copy";
import { EyeIcon as BaseEye } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon as BaseEyeSlash } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { FingerprintIcon as BaseFingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { GearSixIcon as BaseGearSix } from "@phosphor-icons/react/dist/csr/GearSix";
import { HourglassIcon as BaseHourglass } from "@phosphor-icons/react/dist/csr/Hourglass";
import { KeyIcon as BaseKey } from "@phosphor-icons/react/dist/csr/Key";
import { LockKeyOpenIcon as BaseLockKeyOpen } from "@phosphor-icons/react/dist/csr/LockKeyOpen";
import { LockSimpleIcon as BaseLockSimple } from "@phosphor-icons/react/dist/csr/LockSimple";
import { PaperPlaneTiltIcon as BasePaperPlaneTilt } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { PauseIcon as BasePause } from "@phosphor-icons/react/dist/csr/Pause";
import { PlusCircleIcon as BasePlusCircle } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { QrCodeIcon as BaseQrCode } from "@phosphor-icons/react/dist/csr/QrCode";
import { ScanIcon as BaseScan } from "@phosphor-icons/react/dist/csr/Scan";
import { ShieldCheckIcon as BaseShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SuitcaseRollingIcon as BaseSuitcaseRolling } from "@phosphor-icons/react/dist/csr/SuitcaseRolling";
import { UserCircleIcon as BaseUserCircle } from "@phosphor-icons/react/dist/csr/UserCircle";
import { VaultIcon as BaseVault } from "@phosphor-icons/react/dist/csr/Vault";
import { WalletIcon as BaseWallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { WarningCircleIcon as BaseWarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";

/**
 * The product's whole glyph vocabulary, named once.
 *
 * Every generic mark on every surface comes from Phosphor, imported one file at
 * a time rather than through the barrel: the barrel re-exports nine thousand
 * components, which a bundler can shake but a dev server has to parse.
 *
 * Regular weight everywhere. A wallet that mixes weights reads as two products,
 * and the visual system already spends its one axis of emphasis on scale.
 *
 * Brand marks are not here. Wrenchless, Ready Wallet and STRK have their own
 * components, because they are somebody's asset rather than an interface glyph.
 *
 * ---
 *
 * Each glyph is stamped with its own name on the way out, and that name is the
 * whole interface to the motion in `wallet.css`: a key turns clockwise, an
 * hourglass flips, an arrow travels the way it is pointing. The stamp is here
 * rather than at the call sites because the answer belongs to the object and
 * not to the button it happens to be sitting in — the same key turns the same
 * way wherever it appears, and a screen that wants a different answer is
 * telling you it wanted a different glyph.
 */

type Glyph = typeof BaseKey;
type GlyphProps = ComponentProps<Glyph> & { "data-glyph"?: string };

/**
 * `data-*` attributes are typed on intrinsic elements but not on components,
 * and Phosphor spreads whatever it is handed straight onto its own `<svg>`.
 * The cast asserts exactly that and nothing more. Call-site props come last so
 * a caller can still override anything, the stamp included.
 */
function named(Base: Glyph, name: string): (props: GlyphProps) => JSX.Element {
  const stamp: Pick<GlyphProps, "data-glyph"> = { "data-glyph": name };
  return function Named(props: GlyphProps): JSX.Element {
    return <Base {...stamp} {...props} />;
  };
}

export const ArrowDownLeftIcon = named(BaseArrowDownLeft, "arrow-down-left");
export const ArrowRightIcon = named(BaseArrowRight, "arrow-right");
export const ArrowsClockwiseIcon = named(BaseArrowsClockwise, "arrows-clockwise");
export const CalendarPlusIcon = named(BaseCalendarPlus, "calendar-plus");
export const CaretLeftIcon = named(BaseCaretLeft, "caret-left");
export const CaretRightIcon = named(BaseCaretRight, "caret-right");
export const CheckIcon = named(BaseCheck, "check");
export const CheckCircleIcon = named(BaseCheckCircle, "check-circle");
export const ClockClockwiseIcon = named(BaseClockClockwise, "clock-clockwise");
export const ClockCounterClockwiseIcon = named(
  BaseClockCounterClockwise,
  "clock-counter-clockwise",
);
export const CopyIcon = named(BaseCopy, "copy");
export const EyeIcon = named(BaseEye, "eye");
export const EyeSlashIcon = named(BaseEyeSlash, "eye-slash");
export const FingerprintIcon = named(BaseFingerprint, "fingerprint");
export const GearSixIcon = named(BaseGearSix, "gear-six");
export const HourglassIcon = named(BaseHourglass, "hourglass");
export const KeyIcon = named(BaseKey, "key");
export const LockKeyOpenIcon = named(BaseLockKeyOpen, "lock-key-open");
export const LockSimpleIcon = named(BaseLockSimple, "lock-simple");
export const PaperPlaneTiltIcon = named(BasePaperPlaneTilt, "paper-plane-tilt");
export const PauseIcon = named(BasePause, "pause");
export const PlusCircleIcon = named(BasePlusCircle, "plus-circle");
export const QrCodeIcon = named(BaseQrCode, "qr-code");
export const ScanIcon = named(BaseScan, "scan");
export const ShieldCheckIcon = named(BaseShieldCheck, "shield-check");
export const SuitcaseRollingIcon = named(BaseSuitcaseRolling, "suitcase-rolling");
export const UserCircleIcon = named(BaseUserCircle, "user-circle");
export const VaultIcon = named(BaseVault, "vault");
export const WalletIcon = named(BaseWallet, "wallet");
export const WarningCircleIcon = named(BaseWarningCircle, "warning-circle");
