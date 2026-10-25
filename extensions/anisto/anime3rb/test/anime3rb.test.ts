import { contractTests } from "@storm-sources/host/testkit";
import anime3rb from "../src/index";

contractTests(anime3rb, [{ source: "anime3rb", item: "death-note", search: { query: "death note", expect: "Death Note" }, minItems: 10, minChapters: 30 }], `${import.meta.dir}/fixtures`);
