import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SECTION_LIST } from "./config/sections";
import PublicLayout from "./layouts/PublicLayout";
import ContactPage from "./pages/ContactPage";
import HomePage from "./pages/HomePage";
import SectionPage from "./pages/SectionPage";

// Two builds from one codebase:
// - public (`npm run build`)        → Firebase, sir.hamzapatel.co.in. Contains NO admin code.
// - admin  (`npm run build:admin`)  → the panvel-sir-admin Worker, behind Cloudflare Access.
const IS_ADMIN_BUILD = import.meta.env.MODE === "admin";
const AdminPage = IS_ADMIN_BUILD ? lazy(() => import("./pages/AdminPage")) : null;

function App() {
	if (AdminPage) {
		return (
			<Suspense fallback={<div className="admin-loading">Loading admin…</div>}>
				<AdminPage />
			</Suspense>
		);
	}

	return (
		<BrowserRouter>
			<Routes>
				<Route element={<PublicLayout />}>
					<Route path="/" element={<HomePage />} />
					<Route path="/contact" element={<ContactPage />} />
					{SECTION_LIST.map((config) => (
						<Route key={config.key} path={config.path} element={<SectionPage key={config.key} section={config.key} />} />
					))}
				</Route>

				{/* Old links (e.g. /discrepancy, /admin) land on the home page. */}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</BrowserRouter>
	);
}

export default App;
