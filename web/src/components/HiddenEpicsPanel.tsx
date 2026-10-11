import { useEffect, useState, type FormEvent } from "react";
import { getHiddenEpics, hideEpic, unhideEpic, type HiddenEpic } from "../services/api";

// Admin: removal requests. A hidden EPIC disappears from every public search
// (Draft, Final Draft, ASDD) within ~5 minutes (browser cache).
export default function HiddenEpicsPanel() {
	const [items, setItems] = useState<HiddenEpic[]>([]);
	const [epic, setEpic] = useState("");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");

	async function refresh() {
		try {
			setItems((await getHiddenEpics()).hidden);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to load hidden EPICs.");
		}
	}

	useEffect(() => {
		let cancelled = false;
		getHiddenEpics()
			.then((result) => {
				if (!cancelled) setItems(result.hidden);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load hidden EPICs.");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function handleHide(event: FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError("");
		setMessage("");
		try {
			const result = await hideEpic(epic, note);
			setMessage(`${result.epic} is now hidden from all lists.`);
			setEpic("");
			setNote("");
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to hide EPIC.");
		} finally {
			setBusy(false);
		}
	}

	async function handleUnhide(value: string) {
		if (!window.confirm(`Show ${value} in searches again?`)) return;
		setBusy(true);
		setError("");
		setMessage("");
		try {
			await unhideEpic(value);
			setMessage(`${value} is visible again.`);
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to unhide EPIC.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="admin-section">
			<div className="admin-section-heading">
				<div>
					<h2>Hidden EPICs</h2>
					<p>Removal requests from the contact form. Hidden voters never appear in public searches.</p>
				</div>
			</div>

			<form className="admin-version-form" onSubmit={handleHide}>
				<label htmlFor="hide-epic">EPIC number</label>
				<input id="hide-epic" value={epic} onChange={(event) => setEpic(event.target.value)} placeholder="ABC1234567" autoComplete="off" />
				<label htmlFor="hide-note">Note (optional)</label>
				<input id="hide-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Telegram request 12 Oct" maxLength={200} />
				<button type="submit" className="admin-primary-button" disabled={busy || !epic.trim()}>
					Hide in all lists
				</button>
			</form>

			{message && <div className="admin-success">{message}</div>}
			{error && <div className="admin-error">{error}</div>}

			<div className="admin-dataset-list">
				{items.length === 0 && <div className="admin-empty">No hidden EPICs.</div>}
				{items.map((item) => (
					<div className="admin-dataset-row" key={item.epic_no}>
						<div>
							<strong>{item.epic_no}</strong>
							<span>
								{item.note ? `${item.note} · ` : ""}
								{new Date(item.created_at).toLocaleString("en-IN")}
							</span>
						</div>
						<div className="admin-row-actions">
							<button type="button" className="admin-small-button" onClick={() => handleUnhide(item.epic_no)} disabled={busy}>
								Unhide
							</button>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
