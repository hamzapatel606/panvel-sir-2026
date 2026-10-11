import { useEffect, useState } from "react";
import { SECTION_KEYS, type Section } from "../config/sections";
import { getPartsCached, isPublished } from "../services/api";

/**
 * Lists that currently have published data, or null while still loading.
 * Uses the shared parts cache (one request per list).
 */
export function usePublishedSections(): Section[] | null {
	const [published, setPublished] = useState<Section[] | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all(
			SECTION_KEYS.map((key) =>
				getPartsCached(key)
					.then((result) => (isPublished(result) ? key : null))
					.catch(() => null),
			),
		).then((keys) => {
			if (!cancelled) setPublished(keys.filter((key): key is Section => key !== null));
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return published;
}
