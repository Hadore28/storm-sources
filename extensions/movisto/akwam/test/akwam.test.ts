import { contractTests } from "@storm-sources/host/testkit";
import akwam from "../src/index";

contractTests(akwam, [{ source: "akwam", item: "movie/11497/onslaught", search: { query: "batman", expect: "Batman" } }], `${import.meta.dir}/fixtures`);
