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
                one encrypted Travel Safe ticket. The ticket contains the amount,
                return date, known transaction hashes, and early-recovery
                material. A key derived from your passkey encrypts it at rest and
                is kept only for the current unlocked session.
              </p>
              <p>
                The passkey unlocks the ticket, early return, and backup reveal.
                Malware running after you unlock the app can still read what the
                app can read.
              </p>
            </section>

            <section className="document__section">
              <h2>Optional early-recovery backup</h2>
              <p>
                No recovery phrase is required. Early-recovery material stays in
                the encrypted local ticket, so your passkey can reveal an
                optional backup later. The backup can return the Safe early from
                another device. It is not a seed for a new wallet.
              </p>
              <p>
                The backup is never sent to the sponsor. Before the return date,
                another device needs it. After that date, a fresh browser can
                recover by reconnecting the same Ready account.
              </p>
            </section>

            <section className="document__section">
              <h2>Ready and the sponsor</h2>
              <p>
                Ready reads your selected account, private registration,
                shielded STRK balance, and live pool fee. Ready prepares private
                FUND, early-return, and dated-return actions and asks for your
                approval where its Wallet API requires it.
              </p>
              <p>
                The sponsor receives a short-lived prepared FUND proof and may
                broadcast it from an unrelated account. During setup it can see
                the selected Ready account, Safe details, and your network
                address. It never receives the recovery backup.
              </p>
              <p>
                For dated recovery, the sponsor retains an HMAC account tag and
                an encrypted locator containing only the Safe ID and recovery
                salt. A new Travel Safe replaces the previous locator. It does
                not retain the amount, return date, backup, balance, or wallet
                history.
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
                Starknet and retain the live private fee reserve. After the date,
                the same Ready account can recover from a fresh browser.
              </p>
            </section>

            <p className="document__meta">Last revised 25 August 2026.</p>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
