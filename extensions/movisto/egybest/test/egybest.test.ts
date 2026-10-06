import { contractTests } from "@storm-sources/host/testkit";
import egybest from "../src/index";

contractTests(egybest, [{ source: "egybest", item: "series/انمي-7th-time-loop", search: { query: "batman", expect: "Batman" }, minChapters: 3, noGenres: true }], `${import.meta.dir}/fixtures`);
