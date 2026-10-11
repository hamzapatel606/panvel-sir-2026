export type StatIcon = "parts" | "records" | "calendar" | "place";

export interface StatItem {
	label: string;
	value: string;
	icon?: StatIcon;
}

function Icon({ name }: { name: StatIcon }) {
	const common = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
	switch (name) {
		case "parts":
			return (
				<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path d="M7 3.5h7l4 4V19a1.2 1.2 0 0 1-1.2 1.2H7A1.2 1.2 0 0 1 5.8 19V4.7A1.2 1.2 0 0 1 7 3.5Z" {...common} />
					<path d="M9 12h6M9 15.5h6" {...common} />
				</svg>
			);
		case "records":
			return (
				<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<circle cx="9" cy="8" r="3.2" {...common} />
					<path d="M3.5 20v-1c0-2.8 2.5-5 5.5-5s5.5 2.2 5.5 5v1M15.5 4.8a3.2 3.2 0 0 1 0 6.4M17.5 14.3c1.8.7 3 2.4 3 4.7v1" {...common} />
				</svg>
			);
		case "calendar":
			return (
				<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<rect x="4" y="5.5" width="16" height="14.5" rx="2" {...common} />
					<path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" {...common} />
				</svg>
			);
		default:
			return (
				<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" {...common} />
					<circle cx="12" cy="10" r="2.4" {...common} />
				</svg>
			);
	}
}

export default function StatsCards({ stats }: { stats: StatItem[] }) {
	return (
		<div className="stats-cards">
			{stats.map((stat, index) => (
				<div className="stat-card" key={index}>
					{stat.icon && (
						<span className="stat-card-icon">
							<Icon name={stat.icon} />
						</span>
					)}
					<span className="stat-card-text">
						<strong>{stat.value}</strong>
						<span>{stat.label}</span>
					</span>
				</div>
			))}
		</div>
	);
}
