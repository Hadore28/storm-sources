import { contractTests } from "@storm-sources/host/testkit";
import arabic from "../src/index";

contractTests(arabic, [{ source: "arabic-tv", item: "AlJazeera.qa", search: { query: "iraqia", expect: "Iraqia" } }], `${import.meta.dir}/fixtures`);
