import type { JSX } from "react";
import { useEffect } from "react";

import { watchReducedMotion } from "../lib/motion";
import { Footer } from "./Footer";
import { Nav } from "./Nav";

export function PrivacyPage(): JSX.Element {
  useEffect(() => watchReducedMotion(), []);

  return (
    <>
      <a className="skip-link" href="#privacy">
        Skip to the content
      </a>
      <Nav />
      <main className="page page--document" id="main">
        <article className="document grid" id="privacy">
          <header className="bay bay--left document__head">
            <h1 className="document__title">Privacy</h1>
            <p className="document__lede">
              What stays on your device, what Ready handles, and what Starknet
              publishes.
            </p>
          </header>

          <div className="bay bay--left document__body">
            <section className="document__section">
              <h2>On this device</h2>
              <p>
                Wrenchless stores the passkey reference, the active Safe ID, and
                one encrypted Travel Safe ticket. The ticket contains the refund
                key, amount, return date, and known transaction hashes. A
                non-extractable browser AES key encrypts it at rest.
              </p>
              <p>
                The passkey is a local user-verification gate. It does not
                hardware-encrypt the refund key, and ordinary browser storage
                does not resist malware or someone who controls the device.
              </p>
            </section>

            <section className="document__section">
              <h2>Your recovery words</h2>
              <p>
                The twelve words and the claim private key are never stored by
                Wrenchless. The words can release the Safe before its return
                date. Keep them away from the device you travel with.
              </p>
              <p>
                Losing this browser does not destroy a funded Safe if you still
                have the words. Losing both removes Wrenchless&apos;s recovery
                path.
              </p>
            </section>

            <section className="document__section">
              <h2>Ready and the sponsor</h2>
              <p>
                Ready reads your selected account, private registration,
                shielded STRK balance, and live pool fee. Ready prepares private
                FUND, CLAIM, and REFUND actions and asks for your approval where
                its Wallet API requires it.
              </p>
              <p>
                The sponsor receives a short-lived prepared FUND proof and may
                broadcast it from an unrelated account. It can see the request
                and your network address. Wrenchless does not send recovery
                words or either release key to the sponsor.
              </p>
            </section>

            <section className="document__section">
              <h2>What Starknet publishes</h2>
              <p>
                The helper publishes the Safe ID, token, amount, return date,
                and timing. CLAIM and REFUND publish their terminal result.
                Distinctive amounts or closely timed shielding and funding can
                make activity easier to correlate.
              </p>
              <p>
                The helper does not record which Ready account funded the Safe,
                and no destination is chosen until CLAIM or REFUND creates the
                private note. That narrows the public link; it does not make a
                person untraceable.
              </p>
            </section>

            <section className="document__section">
              <h2>Other network requests</h2>
              <p>
                Public RPC providers see the requests and network address used
                to read Starknet. Wrenchless makes no third-party font,
                analytics, or advertising requests.
              </p>
            </section>

            <section className="document__section">
              <h2>Fixed limits</h2>
              <p>
                A return date cannot be extended on the deployed helper. The
                destination Ready account must already support Shielded
                Starknet and retain the live private fee reserve. A device kept
                unlocked until after the return date may be able to request the
                refund.
              </p>
            </section>

            <p className="document__meta">Last revised 24 August 2026.</p>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
