import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ComingSoon from "../components/ComingSoon";
import PdfViewer from "../components/PdfViewer";
import Pagination from "../components/Pagination";
import PartSelector from "../components/PartSelector";
import RecordCard from "../components/RecordCard";
import RecordDetailsModal from "../components/RecordDetailsModal";
import SectionHero from "../components/SectionHero";
import StatsCards from "../components/StatsCards";
import { isSearchField, isTooShortTextSearch, MIN_TEXT_QUERY, needsPart, SECTIONS, type SearchField } from "../config/sections";
import { usePublishedSections } from "../hooks/usePublishedSections";
import { getPartsCached, isPublished, searchRecords, type Part, type Section } from "../services/api";
import { countLabel, getRecordId, type RecordItem } from "../utils/records";

const PAGE_SIZE = 30;

type ListStatus = "loading" | "published" | "unpublished" | "error";

const PLACEHOLDERS: Partial<Record<SearchField, string>> = {
	epic: "Enter EPIC number...",
	serial: "Enter elector serial number...",
	age: "Enter age...",
	gender: "Enter gender...",
	house: "Enter house number...",
	relation: "Enter relation...",
	relative: "Search relative name...",
	name: "Search elector name...",
	referenceEpic: "Enter reference EPIC number...",
	reason: "Enter reason...",
};

export default function SectionPage({ section }: { section: Section }) {
	const config = SECTIONS[section];
	const [searchParams] = useSearchParams();
	const publishedSections = usePublishedSections();
	const crossTargets = (publishedSections ?? []).filter((key) => key !== section);

	const [status, setStatus] = useState<ListStatus>("loading");
	const [parts, setParts] = useState<Part[]>([]);
	const [query, setQuery] = useState("");
	const [searchField, setSearchField] = useState<SearchField>("all");
	const [partNo, setPartNo] = useState("");

	const [records, setRecords] = useState<RecordItem[]>([]);
	const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined]);
	const [pageIndex, setPageIndex] = useState(0);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);

	const [loading, setLoading] = useState(false);
	// False until the user searches or picks a Part. Listing everything would read the whole table.
	const [hasSearched, setHasSearched] = useState(false);
	const [error, setError] = useState("");
	const [selectedRecord, setSelectedRecord] = useState<RecordItem | null>(null);
	const [pdfRecord, setPdfRecord] = useState<RecordItem | null>(null);

	// 1. Is this list published? (Final Draft shows "Coming soon" until it is.)
	useEffect(() => {
		let cancelled = false;
		getPartsCached(section)
			.then((result) => {
				if (cancelled) return;
				setParts(result.parts);
				setStatus(isPublished(result) ? "published" : "unpublished");
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Unable to load parts");
				setStatus("error");
			});
		return () => {
			cancelled = true;
		};
	}, [section]);

	async function fetchPage(
		cursor: string | undefined,
		targetPageIndex: number,
		selectedPartNo: string,
		selectedField: SearchField,
		selectedQuery: string,
	) {
		setLoading(true);
		setError("");
		setHasSearched(true);
		try {
			const result = await searchRecords(
				section,
				selectedQuery,
				selectedField,
				selectedPartNo ? Number(selectedPartNo) : undefined,
				cursor,
				PAGE_SIZE,
			);
			setRecords(result.records as RecordItem[]);
			setNextCursor(result.nextCursor);
			setHasMore(result.hasMore);
			setPageIndex(targetPageIndex);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Search failed");
		} finally {
			setLoading(false);
		}
	}

	function runNewSearch(selectedPartNo = partNo, selectedField = searchField, selectedQuery = query) {
		if (!selectedPartNo && !selectedQuery.trim()) {
			setError("");
			setRecords([]);
			setHasMore(false);
			setNextCursor(null);
			setHasSearched(false);
			return;
		}
		if (isTooShortTextSearch(section, selectedField, selectedQuery)) {
			setError(`Please type at least ${MIN_TEXT_QUERY} letters to search by name.`);
			return;
		}
		if (!selectedPartNo && needsPart(section, selectedField, selectedQuery)) {
			const label = config.searchFields.find((field) => field.value === selectedField)?.label ?? "this field";
			setError(
				selectedField === "all"
					? "To search by Sr No, please select a Part first."
					: `To search by ${label}, please select a Part first.`,
			);
			return;
		}
		setCursorHistory([undefined]);
		void fetchPage(undefined, 0, selectedPartNo, selectedField, selectedQuery);
	}

	// 2. First search, also used by "View in …" links (?searchField=epic&query=…).
	useEffect(() => {
		if (status !== "published") return;
		const urlQuery = searchParams.get("query") ?? "";
		const rawField = searchParams.get("searchField");
		const urlField: SearchField = isSearchField(section, rawField) ? rawField : "all";

		// Sync the form with the URL (?searchField=epic&query=…) and run that search.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setQuery(urlQuery);
		setSearchField(urlField);
		setPartNo("");
		setCursorHistory([undefined]);
		if (!urlQuery.trim()) {
			// Nothing to search yet: show the prompt instead of listing every record.
			setRecords([]);
			setHasMore(false);
			setNextCursor(null);
			setHasSearched(false);
			return;
		}
		void fetchPage(undefined, 0, "", urlField, urlQuery);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [section, searchParams, status]);

	function handlePartChange(value: string) {
		setPartNo(value);
		runNewSearch(value, searchField, query);
	}

	function handleNext() {
		if (!hasMore || !nextCursor) return;
		const targetIndex = pageIndex + 1;
		setCursorHistory((history) => [...history.slice(0, targetIndex), nextCursor]);
		void fetchPage(nextCursor, targetIndex, partNo, searchField, query);
	}

	function handlePrevious() {
		if (pageIndex === 0) return;
		const targetIndex = pageIndex - 1;
		void fetchPage(cursorHistory[targetIndex], targetIndex, partNo, searchField, query);
	}

	const totalRecords = useMemo(() => parts.reduce((sum, part) => sum + (part.record_count ?? 0), 0), [parts]);

	const stats = [
		{ icon: "parts" as const, label: "Parts available", value: parts.length ? parts.length.toLocaleString() : "—" },
		{ icon: "records" as const, label: "Total Records", value: totalRecords ? totalRecords.toLocaleString("en-IN") : "—" },
		{ icon: "calendar" as const, label: "Election Year", value: "2026" },
		{ icon: "place" as const, label: "Panvel Constituency", value: "AC 188" },
	];

	const placeholder = PLACEHOLDERS[searchField] ?? "EPIC, name or serial no...";
	const startIndex = records.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
	const endIndex = pageIndex * PAGE_SIZE + records.length;

	return (
		<section className={`section-page section-theme-${section}`}>
			<SectionHero section={section} title={config.title} description={config.description} />

			{status === "unpublished" && <ComingSoon title={config.unpublishedTitle} text={config.unpublishedText} />}

			{status === "loading" && (
				<div className="skeleton-grid" aria-hidden="true">
					{Array.from({ length: 3 }).map((_, index) => (
						<div className="skeleton-card" key={index}>
							<div className="skeleton-line skeleton-line-title" />
							<div className="skeleton-line" />
							<div className="skeleton-line skeleton-line-sm" />
						</div>
					))}
				</div>
			)}

			{error && (
				<div className="error-message">
					<svg
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						aria-hidden="true"
						style={{ width: 16, height: 16, flex: "0 0 auto", marginTop: 2 }}
					>
						<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
						<path d="M12 8v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
						<circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
					</svg>
					<span>{error}</span>
				</div>
			)}

			{status === "published" && (
				<>
					<StatsCards stats={stats} />

					<div className="search-panel">
						<div className="search-panel-row">
							<div className="search-control search-control-query">
								<label htmlFor={`${section}-query`}>Search Voter Records</label>
								<input
									id={`${section}-query`}
									type="search"
									value={query}
									placeholder={placeholder}
									onChange={(event) => setQuery(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") runNewSearch();
									}}
								/>
							</div>

							<div className="search-control">
								<label htmlFor={`${section}-search-field`}>Search by</label>
								<select
									id={`${section}-search-field`}
									value={searchField}
									onChange={(event) => setSearchField(event.target.value as SearchField)}
								>
									{config.searchFields.map((field) => (
										<option key={field.value} value={field.value}>
											{field.label}
										</option>
									))}
								</select>
							</div>

							<div className="search-control search-control-part">
								<label htmlFor={`${section}-part`}>Select Part</label>
								<PartSelector id={`${section}-part`} parts={parts} value={partNo} onChange={handlePartChange} />
							</div>

							<button type="button" className="search-button" onClick={() => runNewSearch()} disabled={loading}>
								Search
							</button>
						</div>
					</div>

					<div className="results-toolbar">
						<div>
							<strong>{config.title}</strong>
							<span>{records.length === 0 ? "No records displayed" : `Showing ${countLabel(records.length)}`}</span>
						</div>
					</div>

					{loading && (
						<div className="skeleton-grid" aria-hidden="true">
							{Array.from({ length: 6 }).map((_, index) => (
								<div className="skeleton-card" key={index}>
									<div className="skeleton-line skeleton-line-title" />
									<div className="skeleton-line" />
									<div className="skeleton-line" />
									<div className="skeleton-line skeleton-line-sm" />
								</div>
							))}
						</div>
					)}

					{!loading && !hasSearched && !error && (
						<div className="empty-state">
							<div className="empty-icon">
								<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
									<circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
									<path d="m19.5 19.5-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
								</svg>
							</div>
							<strong>Search to see records</strong>
							<span>Type a name or EPIC number, or select a Part to browse it.</span>
						</div>
					)}

					{!loading && hasSearched && records.length === 0 && !error && (
						<div className="empty-state">
							<div className="empty-icon">
								<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
									<circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
									<path d="m19.5 19.5-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
								</svg>
							</div>
							<strong>No records found</strong>
							<span>Try another search or select a different Part.</span>
						</div>
					)}

					{!loading && records.length > 0 && (
						<div className="record-list">
							{records.map((record, index) => (
								<RecordCard
									key={getRecordId(record) || `${section}-${index}`}
									section={section}
									record={record}
									parts={parts}
									crossTargets={crossTargets}
									onOpenDetails={setSelectedRecord}
									onOpenPdf={setPdfRecord}
								/>
							))}
						</div>
					)}

					<Pagination
						startIndex={startIndex}
						endIndex={endIndex}
						canGoPrevious={pageIndex > 0}
						canGoNext={hasMore}
						loading={loading}
						onPrevious={handlePrevious}
						onNext={handleNext}
					/>
				</>
			)}

			{selectedRecord && (
				<RecordDetailsModal
					section={section}
					record={selectedRecord}
					parts={parts}
					onClose={() => setSelectedRecord(null)}
					onOpenPdf={(record) => {
						setSelectedRecord(null);
						setPdfRecord(record);
					}}
				/>
			)}

			{pdfRecord && <PdfViewer section={section} record={pdfRecord} onClose={() => setPdfRecord(null)} />}
		</section>
	);
}
