import type { FC } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAssistantState,
} from "@assistant-ui/react";
import { AddIcon, DeleteIcon } from "./assistant-icons";
import { Button } from "./ui/button";
import { TooltipIconButton } from "./tooltip-icon-button";
import { Skeleton } from "./ui/skeleton";
import React, { useState, useRef, useEffect } from "react";

export const ThreadList: FC = () => {
  // Get current conversation title
  const currentThreadTitle = useAssistantState(({ threads }) => {
    const mainId = threads.mainThreadId;
    const thread = threads.threadItems?.find(
      (item) => item.id === mainId && item.id != "DEFAULT_THREAD_ID",
    );
    return thread ? thread.title : "New Conversation";
  });
  const isLoading = useAssistantState(({ threads }) => threads.isLoading);
  const threadItems = useAssistantState(
    ({ threads }) => threads.threadItems || [],
  );
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Close dropdown after selecting history item
  const handleSelectThread = () => setShowDropdown(false);

  return (
    <div className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-2 py-1">
      <div className="flex items-center justify-between">
        {/* Left: current conversation title */}
        <div className="flex-1 min-w-0">
          <h1
            className="font-medium text-gray-900 dark:text-gray-100 truncate"
            style={{ userSelect: "none", fontSize: "13px", lineHeight: "1.2" }}
          >
            {currentThreadTitle}
          </h1>
        </div>
        {/* Right button area */}
        <div className="flex items-center gap-1 ml-2">
          {/* Conversation history button */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="p-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              title="Conversation History"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
            {/* Dropdown list */}
            {showDropdown && (
              <div className="absolute right-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                <div className="py-1">
                  {isLoading ? (
                    <ThreadListSkeleton />
                  ) : threadItems.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      No conversation history
                    </div>
                  ) : (
                    <div className="py-1 pr-3">
                      {/* Reserve right padding for scrollbar */}
                      <ThreadListPrimitive.Items
                        components={{
                          ThreadListItem: (props) => (
                            <ThreadListItem
                              {...props}
                              onSelect={handleSelectThread}
                            />
                          ),
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* New conversation button */}
          <ThreadListPrimitive.New asChild>
            <Button
              className="flex items-center gap-1 rounded-lg px-2.5 py-2 text-start hover:bg-muted data-active:bg-muted"
              variant="ghost"
              title="New Conversation"
            >
              <AddIcon />
            </Button>
          </ThreadListPrimitive.New>
        </div>
      </div>
    </div>
  );
};

const ThreadListSkeleton: FC = () => {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          role="status"
          aria-label="Loading threads"
          aria-live="polite"
          className="aui-thread-list-skeleton-wrapper flex items-center gap-2 rounded-md px-3 py-2"
        >
          <Skeleton className="aui-thread-list-skeleton h-[22px] flex-grow" />
        </div>
      ))}
    </>
  );
};

const ThreadListItem: FC<{ id?: string; onSelect?: () => void }> = ({ id, onSelect }) => {
  const mainThreadId = useAssistantState(({ threads }) => threads.mainThreadId);
  const isActive = id === mainThreadId;
  return (
    <ThreadListItemPrimitive.Root
      className={`aui-thread-list-item flex items-center gap-2 rounded-lg transition-colors cursor-pointer relative ${isActive ? "text-gray-800 dark:text-gray-100 font-medium" : "text-gray-300 dark:text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"}`}
    >
      <ThreadListItemPrimitive.Trigger
        className="aui-thread-list-item-trigger flex-grow px-3 py-2 text-start pr-8"
        onClick={onSelect}
      >
        <ThreadListItemTitle isActive={isActive} />
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemDelete />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemTitle: FC<{ isActive?: boolean }> = ({ isActive }) => {
  return (
    <span
      className="aui-thread-list-item-title truncate select-none"
      style={{ fontSize: "13px", lineHeight: "1.2" }}
    >
      <ThreadListItemPrimitive.Title fallback="New Conversation" />
    </span>
  );
};

const ThreadListItemDelete: FC = () => {
  return (
    <ThreadListItemPrimitive.Delete asChild>
      <TooltipIconButton
        className="aui-thread-list-item-delete absolute right-2 top-1/2 -translate-y-1/2 size-4 p-0 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-all z-10"
        variant="ghost"
        tooltip="Delete Conversation"
      >
        <DeleteIcon />
      </TooltipIconButton>
    </ThreadListItemPrimitive.Delete>
  );
};
