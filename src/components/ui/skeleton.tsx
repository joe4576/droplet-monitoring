import { cn } from "@/lib/utils";

const Skeleton = ({ className, ...props }: React.ComponentProps<"div">) => {
  return (
    <div
      data-slot="skeleton"
      className={cn({
        inputs: ["animate-pulse rounded-md bg-accent", className],
      })}
      {...props}
    />
  );
};

export { Skeleton };
