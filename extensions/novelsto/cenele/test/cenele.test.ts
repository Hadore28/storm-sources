import { contractTests } from "@storm-sources/host/testkit";
import cenele from "../src/index";

contractTests(cenele, [{ source: "cenele", item: "4289", search: { query: "عبد الظل", expect: "عبد الظل" }, minChapters: 500 }], `${import.meta.dir}/fixtures`);
