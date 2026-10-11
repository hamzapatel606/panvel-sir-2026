import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Turnstile from "../components/Turnstile";
import { sendContact, type ContactRequest } from "../services/api";

// "Found an error or want your entry hidden?"
// Sends the request to the site owner on Telegram. Nothing is stored on this site.

type Status = "idle" | "sending" | "sent" | "error";

export default function ContactPage() {
	const [searchParams] = useSearchParams();
	const [type, setType] = useState<ContactRequest["type"]>(searchParams.get("type") === "error" ? "error" : "hide");
	const [epic, setEpic] = useState(searchParams.get("epic") ?? "");
	const [name, setName] = useState("");
	const [contact, setContact] = useState("");
	const [message, setMessage] = useState("");
	const [token, setToken] = useState("");
	const [resetKey, setResetKey] = useState(0);
	const [status, setStatus] = useState<Status>("idle");
	const [error, setError] = useState("");

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError("");
		if (!token) {
			setError("Please complete the human check below.");
			return;
		}
		setStatus("sending");
		try {
			await sendContact({ type, epic, name, contact, message, turnstileToken: token });
			setStatus("sent");
		} catch (err) {
			setStatus("error");
			setError(err instanceof Error ? err.message : "Could not send your message.");
			// A Turnstile token works once: get a fresh one for the retry.
			setToken("");
			setResetKey((key) => key + 1);
		}
	}

	if (status === "sent") {
		return (
			<section className="contact-page">
				<div className="contact-card contact-done">
					<h1>Request sent</h1>
					<p>
						Thank you. {type === "hide" ? "Your entry will be hidden from searches on this site once it is checked." : "We will check the details and reply if needed."}
					</p>
					<Link to="/" className="search-button contact-home">
						Back to Home
					</Link>
				</div>
			</section>
		);
	}

	return (
		<section className="contact-page">
			<div className="contact-card">
				<span className="page-eyebrow">CONTACT</span>
				<h1>Found an error or want your entry hidden?</h1>
				<p className="contact-intro">Send a request below. It goes directly to the site owner.</p>

				<div className="contact-note">
					<strong>Important:</strong> this site is an unofficial lookup tool. We can <strong>hide your entry from searches on this site</strong>, but we
					cannot change the official voter list. To correct the official record, use{" "}
					<a href="https://voters.eci.gov.in" target="_blank" rel="noopener noreferrer">
						voters.eci.gov.in
					</a>{" "}
					(Form 8).
				</div>

				<form className="contact-form" onSubmit={handleSubmit} noValidate>
					<fieldset className="contact-type">
						<legend>What do you need?</legend>
						<label className={type === "hide" ? "is-selected" : ""}>
							<input type="radio" name="type" value="hide" checked={type === "hide"} onChange={() => setType("hide")} />
							Hide my entry on this site
						</label>
						<label className={type === "error" ? "is-selected" : ""}>
							<input type="radio" name="type" value="error" checked={type === "error"} onChange={() => setType("error")} />
							Report an error on this site
						</label>
					</fieldset>

					<div className="search-control">
						<label htmlFor="contact-epic">EPIC number</label>
						<input
							id="contact-epic"
							value={epic}
							onChange={(event) => setEpic(event.target.value)}
							placeholder="e.g. ABC1234567"
							autoCapitalize="characters"
							autoComplete="off"
							maxLength={20}
							required
						/>
					</div>

					<div className="search-control">
						<label htmlFor="contact-name">Your name</label>
						<input id="contact-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" required />
					</div>

					<div className="search-control">
						<label htmlFor="contact-reply">Phone or email (for our reply)</label>
						<input id="contact-reply" value={contact} onChange={(event) => setContact(event.target.value)} maxLength={100} autoComplete="email" required />
					</div>

					<div className="search-control">
						<label htmlFor="contact-message">{type === "error" ? "What is wrong?" : "Message (optional)"}</label>
						<textarea id="contact-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} rows={4} />
					</div>

					<Turnstile onToken={setToken} resetKey={resetKey} />

					{error && <p className="contact-error">{error}</p>}

					<button type="submit" className="search-button contact-submit" disabled={status === "sending"}>
						{status === "sending" ? "Sending…" : "Send request"}
					</button>

					<p className="contact-privacy">
						Your details are sent to the site owner on Telegram only to handle this request. They are not stored on this site.
					</p>
				</form>
			</div>
		</section>
	);
}
