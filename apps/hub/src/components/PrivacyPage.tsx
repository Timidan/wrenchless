import type { JSX } from "react";
import { useEffect } from "react";
import { Footer } from "./Footer";
import { Nav } from "./Nav";
import { watchReducedMotion } from "../lib/motion";

/**
 * The privacy statement, as a plain document.
 *
 * It is written to be true rather than to be complete-looking, and it is
 * revised the same day the source stops matching it. The distinction it has to
 * draw carefully is between three different places data can sit: this browser,
 * the message service, and nowhere. Collapsing those into one reassuring
 * sentence would be the most damaging thing this page could do, because a
 * person deciding whether to rely on the product reads exactly this.
 *
 * The page renders as a static document on purpose: no smooth scroll, no
 * pinned scenes. A policy that animates is a policy nobody reads.
 */
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
              What stays in your browser, what a service can see, and what is
              never written down anywhere. The three are different and this page
              keeps them apart.
            </p>
          </header>

          <div className="bay bay--left document__body">
            <section className="document__section">
              <h2>This front page</h2>
              <p>
                The page you arrive on keeps nothing. No account, no form, no
                cookie, no storage. Closing the tab leaves nothing behind. The
                application screens at <code>/cover</code>, <code>/vault</code>,{" "}
                <code>/guardian</code> and <code>/setup</code> are different,
                and the rest of this page is about them.
              </p>
            </section>

            <section className="document__section">
              <h2>What your browser keeps</h2>
              <p>
                Using the application writes several things to this browser's
                own storage, on this device. Wrenchless has no account profile
                or analytics record. The mailbox and sponsor receive only the
                requests described below.
              </p>
              <p>
                It keeps a slow one-way check value for each access code, never
                the codes. Those records are created only on the carried phone
                and are not put in its invitation. It keeps the sealed half of
                each one-time top-up code, encrypted under a key held in this
                browser's database. If you use the signal reader, it keeps that
                reader's private key as a browser key object. The carried phone
                also keeps private encryption and signing keys so a copied
                invitation cannot forge its signals. The next section covers
                those keys in detail. It also keeps the service addresses, the
                enrollment you imported and your chosen ceiling. Activity keeps
                each payment's recipient, amount, kind, time, status,
                transaction hash, and any revert reason. It keeps any encrypted
                message that could not be delivered, until it can be.
              </p>
              <p>
                This is browser storage on an ordinary device. It is not a
                secure element, and it does not resist someone who controls the
                machine, or software already running on it. The setup screen
                says the same thing, and the product does not claim otherwise.
              </p>
            </section>

            <section className="document__section">
              <h2>What the message service stores</h2>
              <p>
                The service that carries signals holds fixed-size ciphertext, a
                random message identifier, a random inbox identifier, and two
                timestamps. It has no key and cannot read any of it. It does not
                log request bodies, and every message expires on its own after
                seven days.
              </p>
              <p>
                Because every message is the same size and sent the same way,
                the service cannot tell one kind of signal from another. What it
                can see is that an inbox received something, and when. That is
                real metadata and it is not hidden. The service permits delivery
                only from the device key bound during pairing. The receiver
                rejects messages that are not authenticated by the paired device.
              </p>
            </section>

            <section className="document__section">
              <h2>Private material, and where it stays</h2>
              <p>
                Some private material has to exist for the product to work, and
                pretending otherwise would be the easiest lie on this page. Two
                things in particular are stored, and both are stored locally on
                the one device that needs them.
              </p>
              <p>
                The reader's private key is created in the reader's browser and
                kept there as a browser key object. It never leaves that device,
                is never sent to any service, is never included in the bundle
                handed to the wallet device, and is never displayed. The private
                half of each one-time top-up code is created in the wallet's
                browser and kept there, encrypted under a second key held in the
                same browser. It never leaves that device, is never displayed on
                any screen, and is never included in anything you can copy.
                Neither is written to a log.
              </p>
              <p>
                Both are ordinary browser storage. Losing the browser loses
                them, and someone who controls the device can reach them. What
                is guaranteed is narrower and worth stating exactly: each one
                stays on its own role's device, is never rendered, and is never
                logged or transmitted.
              </p>
            </section>

            <section className="document__section">
              <h2>What is never stored or handed out</h2>
              <p>
                The code digits themselves are not stored. The carried phone
                creates salted verification records locally after it reads the
                invitation; those records never travel in a QR code or link.
                Which valid code you used
                is held only in memory, handed to the encryption routine, and
                cleared when the session closes. Wallet keys, viewing keys, and
                recovery phrases stay in your wallet extension. Decrypted signal
                contents stay on the reader's device.
              </p>
            </section>

            <section className="document__section">
              <h2>What the network sees</h2>
              <p>
                The application screens read Starknet mainnet through a public
                RPC endpoint, which sees your IP address and the addresses you
                ask about, in the ordinary way any web request does. Collecting
                a top-up contacts the relay service, which sees the prepared FUND
                proof it is being asked to broadcast. Claims are built and sent
                by the recipient's Ready Wallet. Fonts load from Google Fonts.
                Those are the third parties. There is no analytics service on any
                page here.
              </p>
            </section>

            <section className="document__section">
              <h2>If you connect a wallet</h2>
              <p>
                Connecting asks your wallet extension for permission. If you
                grant it, the page reads your selected public address and asks
                which wallet API versions the extension supports. Wallet and
                restore screens may read public and private balances while they
                check readiness. Actions that need your authority still open a
                wallet request. A sponsor may broadcast a prepared refill after
                that approval, so there is not always a second prompt at the
                moment of FUND broadcast.
              </p>
            </section>

            <section className="document__section">
              <h2>What none of this hides</h2>
              <p>
                The spending account itself. Its address, its balance and its
                payment history are public on Starknet, like any account. The
                amount and timing of a top-up, which appear in the public call
                trace. That a message was sent, and when. Payments you make
                directly in your wallet extension, which never reach this
                application at all.
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
