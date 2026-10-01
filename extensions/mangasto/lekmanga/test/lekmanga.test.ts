import { contractTests } from "@storm-sources/host/testkit";
import lekmanga from "../src/index";

// read on LekManga: lists and search only
contractTests(lekmanga, [{ source: "lekmanga", search: { query: "solo", expect: "Solo" } }], `${import.meta.dir}/fixtures`);
