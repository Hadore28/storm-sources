import { contractTests } from "@storm-sources/host/testkit";
import rewayat from "../src/index";

contractTests(rewayat, [{ source: "rewayat", item: "path-of-the-extra-1", search: { query: "solo", expect: "سولو" }, minChapters: 300 }], `${import.meta.dir}/fixtures`);
