// /release.json: the editor release this build of the site describes (its Download page, its docs).
// The deploy workflow's hourly check compares it with the newest release to know when to rebuild.
import release from '../data/generated/release.json';

export function GET() {
	return new Response(JSON.stringify({ tag: release.tag, date: release.date ?? null, built: new Date().toISOString() }), {
		headers: { 'content-type': 'application/json' },
	});
}
