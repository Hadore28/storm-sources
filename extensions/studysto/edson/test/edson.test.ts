import { contractTests } from "@storm-sources/host/testkit";
import edson from "../src/index";

contractTests(edson, [{ source: "edson", item: "حسينمحمد", minItems: 5, noGenres: true, search: { query: "حسين", expect: "حسين" } }], `${import.meta.dir}/fixtures`);
