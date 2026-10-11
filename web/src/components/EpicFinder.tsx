import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { SECTIONS, type Section } from "../config/sections";
import { usePublishedSections } from "../hooks/usePublishedSections";
import { getPartsCached, getRecordByEpic, isPublished, type Part } from "../services/api";
import type { RecordItem } from "../utils/records";
import PdfViewer from "./PdfViewer";
import RecordCard from "./RecordCard";
import RecordDetailsModal from "./RecordDetailsModal";

// Home "Find your EPIC" box. Looks in the newest list only:
// Final Draft once it is published, the Draft List until then.
// One indexed lookup per search (cheap on the free plan).

const EPIC_PATTERN = /^[A-Z]{2,4}[A-Z0-9/]{4,14}$/;

type Result =
	| { state: "idle" }
	| { state: "loading" }
	| { state: "found"; section: Section; record: RecordItem; parts: Part[] }
	| { state: "not-found"; section: Section; epic: string }
	| { state: "error"; message: string };

async function newestList(): Promise<Section> {
	try {
		return isPublished(await getPartsCached("final")) ? "final" : "draft";
	} catch {
		return "draft";
	}
}

export default function EpicFinder() {
	const published = usePublishedSections();
	const [epic, setEpic] = useState("");
	const [hint, setHint] = useState("");
	const [result, setResult] = useState<Result>({ state: "idle" });
	const [detailsRecord, setDetailsRecord] = useState<RecordItem | null>(null);
	const [pdfRecord, setPdfRecord] = useState<RecordItem | null>(null);

	// Label shown before any search: which list will be searched.
	const target: Section = published?.includes("final") ? "final" : "draft";
	const finalComingSoon = published !== null && !published.includes("final");

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		const value = epic.trim().toUpperCase().replace(/\s+/g, "");
		if (!EPIC_PATTERN.test(value)) {
			setHint("Enter a full EPIC number, e.g. ABC1234567.");
			return;
		}
		setHint("");
		setResult({ state: "loading" });

		const section = await newestList();
		try {
			const [{ record }, partsResponse] = await Promise.all([
				getRecordByEpic(section, value),
				getPartsCached(section).catch(() => ({ parts: [] as Part[] })),
			]);
			setResult({ state: "found", section, record: record as RecordItem, parts: partsResponse.parts });
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			if (/not found/i.test(message)) {
				setResult({ state: "not-found", section, epic: value });
			} else {
				setResult({ state: "error", message: message || "Something went wrong. Please try again." });
			}
		}
	}

	const searchedSection = result.state === "found" || result.state === "not-found" ? result.section : target;

	return (
		<section className={`epic-finder section-theme-${searchedSection}`} aria-labelledby="epic-finder-title">
			<div className="epic-finder-head">
				<span className="epic-finder-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
						<circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2" />
						<path d="m19.5 19.5-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
					</svg>
				</span>
				<div>
					<h2 id="epic-finder-title">Have a Voter ID (EPIC)?</h2>
					<p>Enter your EPIC number to find it in the {SECTIONS[target].title}.</p>
				</div>
			</div>

			<form className="epic-finder-form" onSubmit={handleSubmit} noValidate>
				<label className="visually-hidden" htmlFor="epic-finder-input">
					EPIC number
				</label>
				<input
					id="epic-finder-input"
					type="search"
					inputMode="text"
					autoCapitalize="characters"
					autoComplete="off"
					spellCheck={false}
					maxLength={20}
					placeholder="EPIC number, e.g. ABC1234567"
					value={epic}
					onChange={(event) => {
						setEpic(event.target.value);
						if (hint) setHint("");
					}}
				/>
				<button type="submit" className="search-button" disabled={result.state === "loading"}>
					{result.state === "loading" ? "Searching…" : "Find"}
				</button>
			</form>

			{/* Always say which list was searched: a Draft result is not the final list. */}
			<p className="epic-finder-scope">
				Searching <strong>{SECTIONS[searchedSection].title}</strong>
				{finalComingSoon && searchedSection === "draft" && <> · Final Draft List coming soon</>}
			</p>

			{hint && <p className="epic-finder-hint">{hint}</p>}

			{result.state === "found" && (
				<div className="epic-finder-result">
					<RecordCard
						section={result.section}
						record={result.record}
						parts={result.parts}
						crossTargets={(published ?? []).filter((key) => key !== result.section)}
						onOpenDetails={setDetailsRecord}
						onOpenPdf={setPdfRecord}
					/>
				</div>
			)}

			{result.state === "not-found" && (
				<div className="epic-finder-empty">
					<strong>
						{result.epic} was not found in the {SECTIONS[result.section].title}.
					</strong>
					<span>Check the number for typing mistakes, or try another list.</span>
					<div className="epic-finder-links">
						{result.section === "final" && (
							<Link to={`/draft?searchField=epic&query=${encodeURIComponent(result.epic)}`}>Search Draft List</Link>
						)}
						<Link to={`/asdd?searchField=epic&query=${encodeURIComponent(result.epic)}`}>Search ASDD List</Link>
						<Link to={SECTIONS[result.section].path}>Search by name</Link>
					</div>
				</div>
			)}

			{result.state === "error" && <p className="epic-finder-error">{result.message}</p>}

			{detailsRecord && result.state === "found" && (
				<RecordDetailsModal
					section={result.section}
					record={detailsRecord}
					parts={result.parts}
					onClose={() => setDetailsRecord(null)}
					onOpenPdf={(record) => {
						setDetailsRecord(null);
						setPdfRecord(record);
					}}
				/>
			)}

			{pdfRecord && result.state === "found" && (
				<PdfViewer section={result.section} record={pdfRecord} onClose={() => setPdfRecord(null)} />
			)}
		</section>
	);
}
