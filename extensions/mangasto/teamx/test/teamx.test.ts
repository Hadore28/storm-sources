import { contractTests } from "@storm-sources/host/testkit";
import teamx from "../src/index";

contractTests(teamx, [{ source: "teamx", manga: "SL", search: { query: "solo leveling", expect: "Solo Leveling" }, minChapters: 150 }], `${import.meta.dir}/fixtures`);
