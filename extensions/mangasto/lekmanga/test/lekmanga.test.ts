import { contractTests } from "@storm-sources/host/testkit";
import lekmanga from "../src/index";

contractTests(lekmanga, [{ source: "lekmanga", manga: "solo-leveling", search: { query: "solo", expect: "Solo" }, minChapters: 100 }], `${import.meta.dir}/fixtures`);
