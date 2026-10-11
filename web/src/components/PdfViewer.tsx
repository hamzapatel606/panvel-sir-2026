import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, type Section } from "../services/api";
import { display, getName, type RecordItem } from "../utils/records";

// In-site PDF viewer: opens the voter's exact page and draws a box around them.
// Works the same on phones (Android Chrome ignores "#page=" links) and laptops.
// PDF.js (~530 KB gzipped) is loaded only when someone opens a PDF.

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
	if (!pdfjsPromise) {
		pdfjsPromise = Promise.all([
			import("pdfjs-dist/legacy/build/pdf.mjs"),
			import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
		])
			.then(([pdfjs, worker]) => {
				pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
				return pdfjs;
			})
			.catch((error) => {
				pdfjsPromise = null; // allow a retry
				throw error;
			});
	}
	return pdfjsPromise;
}

const ZOOM_STEPS = [1, 1.5, 2, 3];

/** Voter box from the import: [x0, y0, x1, y1] as fractions of the page, top-left origin. */
function parseBox(value: unknown): [number, number, number, number] | null {
	if (typeof value !== "string" || !value.trim()) return null;
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed) || parsed.length !== 4) return null;
		const box = parsed.map(Number) as [number, number, number, number];
		if (box.some((n) => !Number.isFinite(n) || n < 0 || n > 1) || box[2] <= box[0] || box[3] <= box[1]) return null;
		return box;
	} catch {
		return null;
	}
}

interface Highlight {
	left: number;
	top: number;
	width: number;
	height: number;
}

function pdfFileUrl(section: Section, record: RecordItem): string {
	return `${API_BASE}/api/${section}/pdf/${String(record.pdf_id)}/file`;
}

export default function PdfViewer({
	section,
	record,
	onClose,
}: {
	section: Section;
	record: RecordItem;
	onClose: () => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const highlightRef = useRef<HTMLDivElement>(null);
	const docRef = useRef<PdfDocument | null>(null);

	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
	const [zoomIndex, setZoomIndex] = useState(0);
	const [pageCount, setPageCount] = useState<number | null>(null);
	const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
	const [highlight, setHighlight] = useState<Highlight | null>(null);

	const fileUrl = pdfFileUrl(section, record);
	const requestedPage = Math.max(1, Number(record.pdf_page) || 1);

	// Close on Escape and stop the page behind from scrolling.
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.key === "Escape") onClose();
		}
		document.addEventListener("keydown", onKey);
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = previousOverflow;
		};
	}, [onClose]);

	const render = useCallback(
		async (cancelled: () => boolean) => {
			const pdfjs = await loadPdfJs();
			if (!docRef.current) {
				docRef.current = await pdfjs.getDocument({
					url: fileUrl,
					rangeChunkSize: 256 * 1024, // fewer, larger requests (rate limit friendly)
					disableAutoFetch: true, // only download what this page needs
					disableStream: true,
					isEvalSupported: false,
				}).promise;
			}
			const doc = docRef.current;
			if (cancelled()) return;
			setPageCount(doc.numPages);

			const page = await doc.getPage(Math.min(requestedPage, doc.numPages));
			const base = page.getViewport({ scale: 1 });
			const available = (scrollRef.current?.clientWidth ?? window.innerWidth) - 16;
			const scale = (available / base.width) * ZOOM_STEPS[zoomIndex];
			const viewport = page.getViewport({ scale });
			const dpr = Math.min(window.devicePixelRatio || 1, 2);

			const canvas = canvasRef.current;
			if (!canvas || cancelled()) return;
			canvas.width = Math.floor(viewport.width * dpr);
			canvas.height = Math.floor(viewport.height * dpr);
			canvas.style.width = `${viewport.width}px`;
			canvas.style.height = `${viewport.height}px`;
			setPageSize({ width: viewport.width, height: viewport.height });

			await page.render({
				canvasContext: canvas.getContext("2d", { alpha: false })!,
				viewport,
				transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
			}).promise;
			if (cancelled()) return;

			// 1st choice: the stored box. 2nd: find the EPIC number in the page text.
			const box = parseBox(record.pdf_box);
			let next: Highlight | null = null;
			if (box) {
				next = {
					left: box[0] * viewport.width,
					top: box[1] * viewport.height,
					width: (box[2] - box[0]) * viewport.width,
					height: (box[3] - box[1]) * viewport.height,
				};
			} else if (typeof record.epic_no === "string" && record.epic_no.trim()) {
				const epic = record.epic_no.trim().toUpperCase();
				const text = await page.getTextContent();
				for (const item of text.items) {
					if (!("str" in item) || !item.str.toUpperCase().includes(epic)) continue;
					const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
					const fontHeight = Math.hypot(item.transform[2], item.transform[3]) * scale;
					next = { left: x - 6, top: y - fontHeight - 6, width: item.width * scale + 12, height: fontHeight + 12 };
					break;
				}
			}
			setHighlight(next);
			setStatus("ready");
		},
		[fileUrl, requestedPage, zoomIndex, record.pdf_box, record.epic_no],
	);

	useEffect(() => {
		let isCancelled = false;
		// Status starts as "loading"; zooming keeps the current page visible until redrawn.
		render(() => isCancelled).catch((error) => {
			console.error("PDF viewer failed", error);
			if (!isCancelled) setStatus("error");
		});
		return () => {
			isCancelled = true;
		};
	}, [render]);

	// Bring the highlighted voter into view once drawn.
	useEffect(() => {
		if (status === "ready" && highlight) {
			highlightRef.current?.scrollIntoView({ block: "center", inline: "center" });
		}
	}, [status, highlight]);

	// Free the PDF when the viewer closes.
	useEffect(() => () => void docRef.current?.destroy(), []);

	return (
		<div className="pdf-viewer" role="dialog" aria-modal="true" aria-label="PDF page viewer">
			<header className="pdf-viewer-bar">
				<div className="pdf-viewer-title">
					<strong>{getName(record)}</strong>
					<span>
						Page {requestedPage}
						{pageCount ? ` of ${pageCount}` : ""} · EPIC {display(record.epic_no)}
					</span>
				</div>
				<div className="pdf-viewer-actions">
					<button
						type="button"
						onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
						disabled={zoomIndex === 0}
						aria-label="Zoom out"
					>
						−
					</button>
					<button
						type="button"
						onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
						disabled={zoomIndex === ZOOM_STEPS.length - 1}
						aria-label="Zoom in"
					>
						+
					</button>
					<button type="button" className="pdf-viewer-close" onClick={onClose} aria-label="Close PDF">
						✕
					</button>
				</div>
			</header>

			<div className="pdf-viewer-scroll" ref={scrollRef}>
				{status === "loading" && <div className="pdf-viewer-status">Loading page {requestedPage}…</div>}
				{status === "error" && (
					<div className="pdf-viewer-status">
						Couldn't load this page.{" "}
						<a href={`${fileUrl}#page=${requestedPage}`} target="_blank" rel="noopener noreferrer">
							Open the full PDF
						</a>
					</div>
				)}
				<div
					className="pdf-viewer-page"
					style={{ width: pageSize.width || undefined, height: pageSize.height || undefined, visibility: status === "error" ? "hidden" : "visible" }}
				>
					<canvas ref={canvasRef} />
					{highlight && status === "ready" && (
						<div
							ref={highlightRef}
							className="pdf-viewer-highlight"
							style={{ left: highlight.left, top: highlight.top, width: highlight.width, height: highlight.height }}
						/>
					)}
				</div>
			</div>

			<footer className="pdf-viewer-foot">
				{status === "ready" && !highlight && <span>Voter position not marked on this page.</span>}
				<a href={`${fileUrl}#page=${requestedPage}`} target="_blank" rel="noopener noreferrer">
					Open full PDF
				</a>
			</footer>
		</div>
	);
}
