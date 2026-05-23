
app_js_path = r"C:\Anay\Programming\Projects\Voxly\frontend\src\App.js"

with open(app_js_path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix imports first
content = content.replace("  RefreshCw,\n} from 'lucide-react';", "  RefreshCw,\n  ChevronDown,\n} from 'lucide-react';")

# We want to replace the sections in the JSX with our components.
# Let's locate the parts.

# 1. UserHeader
header_start = content.find("{/* Header */}")
header_end = content.find("{pendingSyncCount > 0 && (")
if header_start != -1 and header_end != -1:
    content = content[:header_start] + """
        <UserHeader
          displayName={displayName}
          userEmail={userEmail}
          onLogout={onLogout}
          loggingEnabled={loggingEnabled}
          preferenceSaving={preferenceSaving}
          handlePreferenceToggle={handlePreferenceToggle}
        />

        """ + content[header_end:]

# 2. Top Section: Microphone and Dropdowns
top_sec_start = content.find("{/* Top Section: Microphone and Dropdowns */}")
top_sec_end = content.find("{/* Recurring Expenses Card */}")
if top_sec_start != -1 and top_sec_end != -1:
    content = content[:top_sec_start] + """
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="col-span-12 lg:col-span-5">
            <VoiceButton
              toggleRecording={toggleRecording}
              voiceProcessing={voiceProcessing}
              voiceConfirm={voiceConfirm}
              isRecording={isRecording}
              voiceStatus={voiceStatus}
            />
          </div>
          <SummaryDropdowns
            toggleSection={toggleSection}
            expandedSection={expandedSection}
            todayTotal={todayTotal}
            weeklyTotal={weeklyTotal}
            dailyAverage={dailyAverage}
            weeklyTopCategories={weeklyTopCategories}
            weeklySummaryLines={weeklySummaryLines}
            monthlyTotal={monthlyTotal}
            monthlySummaryLines={monthlySummaryLines}
            monthlyCategories={monthlyCategories}
            forecast={forecast}
          />
        </div>

        """ + content[top_sec_end:]

# 3. Charts Section
charts_start = content.find("{/* Charts Section */}")
charts_end = content.find("{/* Recent Expenses */}")
if charts_start != -1 and charts_end != -1:
    content = content[:charts_start] + """
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <CategoryPieChart categorySpending={categorySpending} />
          <DailyBarChart dailySpending={dailySpending} maxDaily={maxDaily} userBudgets={userBudgets} />
          <MonthlyBarChart monthlyTrend={monthlyTrend} maxMonthly={maxMonthly} forecast={forecast} />
        </div>

        """ + content[charts_end:]


# 4. Recent Expenses
recent_start = content.find("{/* Recent Expenses */}")
recent_end = content.find("{/* Add Expense Manually */}")
if recent_start != -1 and recent_end != -1:
    content = content[:recent_start] + """
        <ExpenseTable
          recentExpenses={recentExpenses}
          loading={loading}
          expenseFilter={expenseFilter}
          setExpenseFilter={setExpenseFilter}
          getRecent={getRecent}
          setRecentExpenses={setRecentExpenses}
          mapRecentExpenses={mapRecentExpenses}
          editingId={editingId}
          setEditingId={setEditingId}
          editForm={editForm}
          setEditForm={setEditForm}
          apiUpdateExpense={apiUpdateExpense}
          setToast={setToast}
          loadData={loadData}
          categories={Object.keys(userBudgets).length > 0 ? Object.keys(userBudgets) : ['food', 'transport', 'utilities']}
        />

        """ + content[recent_end:]

# 5. Add Expense Manually
add_exp_start = content.find("{/* Add Expense Manually */}")
add_exp_end = content.find("{/* Set Budget Widget */}")
if add_exp_start != -1 and add_exp_end != -1:
    content = content[:add_exp_start] + """
        <AddExpenseForm
          newExpense={newExpense}
          setNewExpense={setNewExpense}
          handleAddExpense={handleAddExpense}
          submitting={submitting}
          categories={Object.keys(userBudgets).length > 0 ? Object.keys(userBudgets) : ['food', 'transport', 'utilities']}
        />

        """ + content[add_exp_end:]


# 6. Category Summary
cat_sum_start = content.find("{/* Category Summary */}")
cat_sum_end = content.find("      </div>\n      <ConfirmDialog")
if cat_sum_start != -1 and cat_sum_end != -1:
    content = content[:cat_sum_start] + """
        <CategorySummary categoryData={categoryData} />
""" + content[cat_sum_end:]


with open(app_js_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Done")
