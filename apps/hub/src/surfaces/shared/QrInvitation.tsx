import type { JSX } from "react";
import QRCode from "react-qr-code";

import { CopyValue } from "./CopyValue";

/**
 * An invitation, in the two forms a person can actually use.
 *
 * The QR is drawn here from the same value shown underneath it, so there is one
 * source and no chance of a code that scans to something other than what the
 * screen says. Error correction is set low on purpose: these payloads carry key
 * material and a capability, and at this length a higher level pushes the module
 * count past what a phone camera can resolve on a phone screen.
 *
 * The copyable value is not a fallback for completeness. A cracked lens, a
 * locked-down camera and a screen reader all arrive here instead, and a pairing
 * step that only works one way is a pairing step that strands people.
 */
export function QrInvitation(props: {
  label: string;
  link: string;
  code: string;
  /** What the value under the code is, when it is not an invitation. */
  codeLabel?: string | undefined;
  /** Copy the camera-ready link instead of exposing its raw invitation token. */
  copyLink?: boolean | undefined;
  note?: string | undefined;
}): JSX.Element {
  return (
    <div className="qr">
      <div className="qr__code">
        <QRCode
          aria-label={props.label}
          bgColor="#ffffff"
          fgColor="#141414"
          level="L"
          size={256}
          value={props.link}
        />
      </div>
      <CopyValue
        label={props.copyLink === true ? "Invitation link" : (props.codeLabel ?? "Invitation code")}
        {...(props.note === undefined ? {} : { note: props.note })}
        value={props.copyLink === true ? props.link : props.code}
      />
    </div>
  );
}
