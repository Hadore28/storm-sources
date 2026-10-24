import { contractTests } from "@storm-sources/host/testkit";
import iptvorg from "../src/index";

contractTests(iptvorg, [{ source: "iptvorg", item: "AlJazeera.qa", search: { query: "jazeera", expect: "Al Jazeera" } }], `${import.meta.dir}/fixtures`);
