import { contractTests } from "@storm-sources/host/testkit";
import egydead from "../src/index";

contractTests(egydead, [{ source: "egydead", item: "serie/breaking-bad-2008", search: { query: "inception", expect: "Inception" }, minChapters: 5 }], `${import.meta.dir}/fixtures`);
