import { contractTests } from "@storm-sources/host/testkit";
import anime4up from "../src/index";

contractTests(anime4up, [{ source: "anime4up", item: "death-note", search: { query: "death note", expect: "Death Note" }, minItems: 10, minChapters: 30 }], `${import.meta.dir}/fixtures`);
