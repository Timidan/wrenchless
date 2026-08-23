import type { JSX } from "react";
import QRCode from "react-qr-code";

import { Actions, Button, Screen } from "../shared/product";
import { CopyValue } from "../shared/CopyValue";

/**
 * Receive: an address, at the two sizes it gets used at.
 *
 * A wallet's receiving address is public and dull, which is exactly why this
 * screen is short. The QR is the address itself so a camera can take it, and
 * the full value sits underneath because half the time it is going into a
 * message rather than a lens.
 *
 * Nothing here is generated or reserved. It is the account already connected,
 * so there is no state to get wrong and nothing to wait for.
 */
export function ReceiveView(props: {
  account: string;
  onDone: () => void;
}): JSX.Element {
  return (
    <Screen
      lede="Anyone can send STRK to this address."
      onBack={props.onDone}
      title="Receive"
    >
      <div className="qr">
        <div className="qr__code">
          <QRCode
            aria-label="QR code for your receiving address"
            bgColor="#ffffff"
            fgColor="#141414"
            level="M"
            size={256}
            value={props.account}
          />
        </div>
        <CopyValue label="Your address" value={props.account} />
      </div>
      <Actions>
        <Button label="Done" onClick={props.onDone} />
      </Actions>
    </Screen>
  );
}
