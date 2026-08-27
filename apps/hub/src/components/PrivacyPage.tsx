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
                one encrypted Travel Safe ticket. The ticket holds the amount,
                the schedule, known transaction hashes, and the device action
                key. A key derived from your passkey encrypts it at rest and is
                kept only for the current unlocked session.
              </p>
              <p>
                The passkey unlocks the local ticket and protects the release and
                extend controls. Malware running after you unlock the app can
                still read what the app can read.
              </p>
            </section>

            <section className="document__section">
              <h2>Your recovery words</h2>
              <p>
                Recovery words are generated when you set a Safe up and shown
                once. They stay in the page&rsquo;s memory only until the setup
                funding is sent. They are never written into the ticket and never
                sent to the sponsor, so only you can save them.
              </p>
              <p>
                Saved recovery words authorise returning the whole reserve early.
                They are not a seed for a new wallet, and nobody can reissue them
                for you.
              </p>
            </section>

            <section className="document__section">
              <h2>Rescue Mode</h2>
              <p>
                Rescue derives the return authority from your words in this
                page&rsquo;s memory. The words are never sent anywhere, and
                Wrenchless never stores them.
              </p>
              <p>
                A rescue sends the remaining reserve to the Ready account you
                connect at that moment, and only before the return date. That
                account needs enough private STRK for the action fee.
              </p>
            </section>

            <section className="document__section">
              <h2>Ready and the sponsor</h2>
              <p>
                Ready holds your account keys. It prepares and signs the STRK20
                actions a Travel Safe needs and asks for your approval where its
                Wallet API requires it.
              </p>
              <p>
                The sponsor receives short-lived prepared FUND or TOP_UP material
                and the exact public Safe inputs it needs to verify and broadcast
                the action. It never receives your recovery words.
              </p>
            </section>

            <section className="document__section">
              <h2>What Starknet publishes</h2>
              <p>
                The helper publishes the Safe ID, token, amount, schedule, timing,
                and status. Distinctive amounts or closely timed shielding and
                funding can make activity easier to correlate.
              </p>
              <p>
                The helper does not record which Ready account funded the Safe.
                That narrows the link to an account; it does not hide the facts
                above.
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
              <h2>Current limits</h2>
              <p>
                A Travel Safe holds STRK or USDC for up to 180 days, on a daily
                or single-date schedule. One Safe is active per browser at a
                time. You can top up and extend within that lifetime.
              </p>
            </section>

            <section className="document__section">
              <h2>Legacy Safes</h2>
              <p>
                Backup and recovery for existing v2 Safes remains available at{" "}
                <a href="/recover">/recover</a>.
              </p>
            </section>

            <p className="document__meta">Last revised 27 August 2026.</p>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
