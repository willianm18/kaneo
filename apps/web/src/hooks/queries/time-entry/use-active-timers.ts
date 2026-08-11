import { useQuery } from "@tanstack/react-query";
import getActiveTimers from "@/fetchers/time-entry/get-active-timers";

export function useActiveTimers() {
  return useQuery({
    queryKey: ["active-timers"],
    queryFn: getActiveTimers,
    refetchOnWindowFocus: true,
  });
}

export default useActiveTimers;
