import { Link } from "react-router-dom";

/** Shown on a list page while that list has no published data (e.g. Final Draft). */
export default function ComingSoon({ title, text }: { title: string; text: string }) {
	return (
		<div className="coming-soon" role="status">
			<div className="coming-soon-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
					<circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
					<path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</div>
			<strong>{title}</strong>
			<p>{text}</p>
			<Link to="/" className="coming-soon-link">
				Back to all lists
			</Link>
		</div>
	);
}
