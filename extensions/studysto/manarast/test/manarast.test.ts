import { contractTests } from "@storm-sources/host/testkit";
import manara from "../src/index";

contractTests(manara, [{ source: "manara-st", item: "حيدرعبدالائمه", minItems: 5, noGenres: true, search: { query: "الزبيدي", expect: "الزبيدي" } }], `${import.meta.dir}/fixtures`);
