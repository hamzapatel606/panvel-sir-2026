import { useEffect } from "react";
import type { Part, Section } from "../services/api";
import {
	display,
	getDetailFields,
	getName,
	hasPdf,
	sectionKicker,
	type RecordItem,
} from "../utils/records";

export default function RecordDetailsModal({
	section,
	record,
	parts,
	onClose,
	onOpenPdf,
}: {
	section: Section;
	record: RecordItem;
	parts: Part[];
	onClose: () => void;
	onOpenPdf: (record: RecordItem) => void;
}) {
	useEffect(() => {
		function handleKey(event: KeyboardEvent) {
			if (event.key === "Escape") onClose();
		}

		document.addEventListener("keydown", handleKey);
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		return () => {
			document.removeEventListener("keydown", handleKey);
			document.body.style.overflow = previousOverflow;
		};
	}, [onClose]);

	const recordHasPdf = hasPdf(record);

	return (
		<div
			className="record-modal-overlay"
			onClick={onClose}
			role="presentation"
		>
			<div
				className={`record-modal record-modal-${section}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby="record-modal-title"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="record-modal-header">
					<div>
						<span className="record-card-kicker">{sectionKicker(section)}</span>
						<h2 id="record-modal-title">{getName(record)}</h2>
					</div>
					<button
						type="button"
						className="record-modal-close"
						onClick={onClose}
						aria-label="Close details"
					>
						<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
							<path
								d="M6 6l12 12M18 6 6 18"
								stroke="currentColor"
								strokeWidth="1.9"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				<div className="record-modal-body">
					<dl className="record-detail-list">
						{getDetailFields(section, record, parts).map((field, index) => (
							<div className="record-detail-row" key={index}>
								<dt>{field.label}</dt>
								{field.list ? (
									<dd>
										<ul className="record-field-list">
											{field.list.map((item, itemIndex) => (
												<li key={itemIndex}>{item}</li>
											))}
										</ul>
									</dd>
								) : (
									<dd>{display(field.value)}</dd>
								)}
							</div>
						))}
					</dl>
				</div>

				<div className="record-modal-footer">
					<button
						type="button"
						className={`card-action card-action-pdf${!recordHasPdf ? " is-unavailable" : ""}`}
						disabled={!recordHasPdf}
						onClick={() => {
							if (recordHasPdf) onOpenPdf(record);
						}}
					>
						{recordHasPdf ? "View PDF" : "PDF Not Available"}
					</button>
					<button type="button" className="card-action card-action-secondary" onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
